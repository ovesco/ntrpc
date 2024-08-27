import { ConsumeOptions, ConsumerMessages, JsMsg } from "nats";
import { Context, ProcedureHandlerParams, SchemaHandler } from "../types";
import Procedure from "./Procedure";
import deepmerge from "deepmerge";
import { getDurableName } from "../utils";
import { NTRPCError } from "../Error";
import { buildMiddlewaresUnwrapper, Middleware } from "./Middleware";
import { RuntimeContext } from "../Runtime";
import { DataStore } from "../DataStore";
import { getConsumerInfo, setupStream } from "./jetstream";

type MessageStatus = "SCHEDULED" | "EXECUTED" | "ERROR" | "RUNNING";

type QueueConfig = {
  streamName: string;
  consumerName: string;
  waitForAck: number;
  autoAck: boolean;
  consumeOptions: Partial<ConsumeOptions>;

  /**
   * Max number of times we try to execute the job in case of errors
   * By default is 1
   */
  executionRetry: number;

  /**
   * Time in milliseconds to wait before rescheduling the job in case of errors
   */
  retryDelay: number;

  /**
   * Time in milliseconds to wait for the job to be executed before considering
   * it as failed
   */
  timeout: number;

  /**
   * Wether to allow messages to be scheduled for later by the client
   * This will require two sent messages from the server, a first sent
   * immediately which will be rejected because it is scheduled for later,
   * and another one which will be sent at the correct time
   */
  allowScheduledMessages: boolean;

  /**
   * The data store to use for storing the state of workers, messages, retries
   * and more
   */
  dataStore: DataStore;
};

export type QueueResolver<
  Ctx extends Context,
  InputSchema extends SchemaHandler
> = (
  params: ProcedureHandlerParams<Ctx, InputSchema, JsMsg>
) => void | Promise<void>;

/**
 * A Queue procedure acts as a worker. Messages are queued on a stream and
 * picked one after the other by an available consumer. Note that messages are picked
 * as fast as possible.
 *
 * It is possible to delay a message's execution by setting the `scheduledAt` header but
 * without any guarantees that it will be picked at the exact time as it depends on wether
 * a worker is available.
 */
export default class Queue<
  Ctx extends Context,
  InputSchema extends SchemaHandler
> extends Procedure {
  private subscription: ConsumerMessages;

  constructor(
    middlewares: Array<Middleware<any, any>>,
    private inputSchema?: InputSchema,
    private resolver?: QueueResolver<Ctx, InputSchema>,
    private config?: Partial<QueueConfig>
  ) {
    super(middlewares);
  }

  input<TInput extends SchemaHandler>(schema: TInput) {
    return new Queue<Ctx, TInput>(
      this.middlewares,
      schema,
      this.resolver as any,
      this.config
    );
  }

  resolve(resolver: QueueResolver<Ctx, InputSchema>) {
    return new Queue<Ctx, InputSchema>(
      this.middlewares,
      this.inputSchema,
      resolver,
      this.config
    );
  }

  async stop() {
    await this.subscription?.close();
  }

  async start(runtimeContext: RuntimeContext, subject: string) {
    const { logger } = runtimeContext.configuration;
    const config = deepmerge<QueueConfig>(this.config || {}, {
      streamName: getDurableName(subject),
      consumerName: `c-${getDurableName(subject)}`,
      waitForAck: 30000,
      timeout: 30000,
      executionRetry: 1,
      retryDelay: 1000,
      autoAck: true,
      consumeOptions: {},
      allowScheduledMessages: true,
      dataStore: runtimeContext.dataStore,
    });

    await setupStream(runtimeContext, config.streamName, subject);
    const consumerInfo = await getConsumerInfo(
      runtimeContext,
      config.streamName,
      config.consumerName,
      subject,
      config.waitForAck
    );

    const consumer = await runtimeContext.nats
      .jetstream()
      .consumers.get(config.streamName, consumerInfo.name);

    const subscription = await consumer.consume(config.consumeOptions);
    this.subscription = subscription;

    (async () => {
      for await (const m of subscription) {
        const prefix = runtimeContext.configuration.natsHeadersPrefix;
        const scheduledAt = m.headers?.get(`${prefix}scheduledAt`);
        const messageId = m.headers?.get(`${prefix}message-id`);

        if (!messageId) {
          logger.warn(
            { subject },
            `A message was received without messageId, ignoring it`
          );
          m.ack();
          continue;
        }

        // Check if message is scheduled for later and, if so, requeue it
        if (scheduledAt) {
          if (!config.allowScheduledMessages) {
            logger.warn(
              { subject, messageId, scheduledAt },
              "A message was scheduled for later but it is not allowed, processing it immediately"
            );
          } else {
            // Check if it is time to process the message
            const scheduledTime = new Date(scheduledAt);
            if (scheduledTime > new Date()) {
              // Requeue the message
              // Nats expects delay to be specified in milliseconds
              m.nak(scheduledTime.getTime() - Date.now());
              runtimeContext.dataStore.set(
                this.getDataStoreMessageKey(messageId),
                "SCHEDULED"
              );
              continue;
            }
          }
        }

        // Check if message should be processed
        const shouldProcess = await this.shouldBeProcessed(
          runtimeContext,
          config,
          messageId
        );

        if (!shouldProcess) {
          m.ack();
          continue;
        }

        try {
          const unwrap = buildMiddlewaresUnwrapper(
            runtimeContext,
            this.middlewares
          );
          await unwrap(m, this.inputSchema, async ({ ctx, envelope }) => {
            // Set message as running
            await runtimeContext.dataStore.set(
              this.getDataStoreMessageKey(messageId),
              "RUNNING"
            );

            // Increment retry count
            await this.incrementRetryCount(runtimeContext, messageId);

            // Set start execution time
            await this.setStartExecutionTime(runtimeContext, messageId);

            await this.resolver!({
              ctx: ctx as unknown as Ctx,
              input: envelope.data,
              message: m,
              envelope,
            });

            // Set message as executed
            await runtimeContext.dataStore.set(
              this.getDataStoreMessageKey(messageId),
              "EXECUTED"
            );
          });
        } catch (error) {
          if (error instanceof NTRPCError && error.code === "INVALID_DATA") {
            runtimeContext.configuration.logger.warn(error);
          } else {
            // Set message as error
            await runtimeContext.dataStore.set(
              this.getDataStoreMessageKey(messageId),
              "ERROR"
            );

            // Schedule for retry
            m.nak(config.retryDelay);

            // Forward down
            throw error;
          }
        }
      }
    })();
  }

  private getDataStoreMessageKey(messageId: string) {
    return `job:${messageId}`;
  }

  private async shouldBeProcessed(
    runtimeContext: RuntimeContext,
    config: QueueConfig,
    messageId: string
  ) {
    const state = await runtimeContext.dataStore.get<MessageStatus>(
      this.getDataStoreMessageKey(messageId)
    );

    if (state === "EXECUTED") {
      return false;
    }

    if (state === "ERROR") {
      // Check if we're within retry threshold
      const retryCount = await this.getRetryCount(runtimeContext, messageId);
      if (retryCount > config.executionRetry) {
        return false;
      }

      return true;
    }

    if (state === "RUNNING") {
      // Check if we're within retry threshold
      const start = await this.getStartExecutionTime(runtimeContext, messageId);
      if (!start) {
        // No start time found, we're in a weird state, schedule it again
        return true;
      }

      const now = new Date();
      if (now.getTime() - start.getTime() > config.timeout) {
        // Timeout reached, schedule it again if we're still in retry threshold
        const retryCount = await this.getRetryCount(runtimeContext, messageId);
        if (retryCount > config.executionRetry) {
          return false;
        }

        return true;
      }

      return false; // Job is still running with another worker
    }

    // Job is in SCHEDULED state or not found
    return true;
  }

  private async getRetryCount(
    runtimeContext: RuntimeContext,
    messageId: string
  ) {
    const count = await runtimeContext.dataStore.get(
      `${this.getDataStoreMessageKey(messageId)}-retry`
    );

    return count ? parseInt(count) : 0;
  }

  private async incrementRetryCount(
    runtimeContext: RuntimeContext,
    messageId: string
  ) {
    const count = await this.getRetryCount(runtimeContext, messageId);
    await runtimeContext.dataStore.set(
      `${this.getDataStoreMessageKey(messageId)}-retry`,
      (count + 1).toString()
    );
  }

  private async setStartExecutionTime(
    runtimeContext: RuntimeContext,
    messageId: string
  ) {
    await runtimeContext.dataStore.set(
      `${this.getDataStoreMessageKey(messageId)}-start`,
      new Date().toISOString()
    );
  }

  private async getStartExecutionTime(
    runtimeContext: RuntimeContext,
    messageId: string
  ) {
    const start = await runtimeContext.dataStore.get<string>(
      `${this.getDataStoreMessageKey(messageId)}-start`
    );

    return start ? new Date(start) : undefined;
  }
}