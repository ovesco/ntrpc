import deepmerge from "deepmerge";
import { Context, ProcedureHandlerParams, SchemaHandler } from "../types";
import { NTRPCError } from "../Error";
import { ConsumerOpts, Msg, Subscription } from "nats";
import Procedure from "./Procedure";
import { BaseEncoders } from "../encoders";
import { buildMiddlewaresUnwrapper, Middleware } from "./Middleware";
import { RuntimeContext } from "../Runtime";
import { getDefaultNatsHeaders } from "../Envelope";

export type QueryResolver<
  Ctx extends Context,
  InputSchema extends SchemaHandler
> = (params: ProcedureHandlerParams<Ctx, InputSchema, Msg>) => any;

type QueryConfig = {
  responseEncoding: `${string}/${string}`;
  opts: Partial<ConsumerOpts>;
};

/**
 * A Query procedure acts as a request-response handler. When a message is
 * processed by the query handler, the callback's result will be sent back
 * to the client.
 */
export default class Query<
  Ctx extends Context,
  Encoders extends BaseEncoders,
  Encoder extends keyof Encoders = "application/json",
  InputSchema extends SchemaHandler = never,
  Resolver extends QueryResolver<Ctx, InputSchema> = never
> extends Procedure {
  private subscription?: Subscription;

  constructor(
    middlewares: Array<Middleware<any, any>>,
    private inputSchema?: InputSchema,
    private resolver?: Resolver,
    private config?: QueryConfig
  ) {
    super(middlewares);
  }

  input<TInput extends SchemaHandler>(schema: TInput) {
    return new Query<
      Ctx,
      Encoders,
      Encoder,
      TInput,
      QueryResolver<Ctx, TInput>
    >(this.middlewares, schema, this.resolver as any, this.config);
  }

  resolve<Resolver extends QueryResolver<Ctx, InputSchema>>(
    resolver: Resolver
  ) {
    return new Query<Ctx, Encoders, Encoder, InputSchema, Resolver>(
      this.middlewares,
      this.inputSchema,
      resolver,
      this.config
    );
  }

  consumerOptions(config: Partial<ConsumerOpts>) {
    return new Query<Ctx, Encoders, Encoder, InputSchema, Resolver>(
      this.middlewares,
      this.inputSchema,
      this.resolver,
      deepmerge<QueryConfig>(this.config || {}, { opts: config })
    );
  }

  responseEncoding<K extends keyof Encoders>(encoder: K) {
    return new Query<Ctx, Encoders, K, InputSchema, Resolver>(
      this.middlewares,
      this.inputSchema,
      this.resolver,
      deepmerge<QueryConfig>(this.config || {}, {
        responseEncoding: encoder as any,
      })
    );
  }

  async stop() {
    return await this.subscription?.drain();
  }

  async start(runtimeContext: RuntimeContext, subject: string) {
    if (!this.resolver) {
      throw new NTRPCError(
        "INTERNAL_ERROR",
        `No resolver defined for query handler ${subject}`
      );
    }

    const sub = runtimeContext.nats.subscribe(subject, this.config?.opts);
    this.subscription = sub;

    (async () => {
      for await (const m of sub) {
        const replySubject = m.reply;
        if (!replySubject) {
          // Nothing more to do we have nowhere to send
          // the reply to
          runtimeContext.configuration.logger.info({
            subject,
            message: "No reply subject set",
          });

          continue;
        }

        // Unwrap middlewares
        try {
          const unwrap = buildMiddlewaresUnwrapper(
            runtimeContext,
            this.middlewares
          );
          await unwrap(m, this.inputSchema, async ({ ctx, envelope }) => {
            const res = await this.resolver!({
              ctx: ctx as unknown as Ctx,
              input: envelope.data,
              message: m,
              envelope,
            });

            // Build a reply envelope with response payload
            const encoding =
              this.config?.responseEncoding || "application/json";
            const replyHeaders = getDefaultNatsHeaders(
              runtimeContext.configuration,
              subject,
              encoding,
              envelope.id
            );

            const { encoders } = runtimeContext;
            const encoder = encoders[encoding as keyof typeof encoders];
            if (!encoder) {
              throw new NTRPCError(
                "UNKNOWN_ENCODER",
                `Unknown encoder ${encoding} when trying to send response back`
              );
            }

            // Send response
            runtimeContext.nats.publish(
              replySubject,
              encoder.encode(res as any),
              { headers: replyHeaders }
            );
          });
        } catch (error) {
          if (error instanceof NTRPCError && error.code === "INVALID_DATA") {
            runtimeContext.configuration.logger.info(error);
          } else {
            // Forward down
            throw error;
          }
        }
      }
    })();
  }
}