import deepmerge from "deepmerge";
import { Context, ProcedureHandlerParams, SchemaHandler } from "../types";
import { NTRPCError } from "../Error";
import { ConsumerOpts, Msg, Subscription } from "nats";
import Procedure from "./Procedure";
import { buildMiddlewaresUnwrapper, Middleware } from "./Middleware";
import { RuntimeContext } from "../Runner";

export type DispatchResolver<
  Ctx extends Context,
  InputSchema extends SchemaHandler
> = (params: ProcedureHandlerParams<Ctx, InputSchema, Msg>) => any;

type DispatchConfig = {
  opts: Partial<ConsumerOpts>;
};

/**
 * A dispatch procedure acts as a basic fire-and-forget handler. When a message
 * is processed by the dispatch handler, the callback's result will not be sent
 * back to the client.
 */
export default class Dispatch<
  Ctx extends Context,
  InputSchema extends SchemaHandler = never,
  Resolver extends DispatchResolver<Ctx, InputSchema> = never
> extends Procedure {
  private subscription?: Subscription;

  constructor(
    middlewares: Array<Middleware<any, any>>,
    private inputSchema?: InputSchema,
    private resolver?: Resolver,
    private config?: DispatchConfig
  ) {
    super(middlewares);
  }

  type(): "dispatch" {
    return "dispatch";
  }

  input<TInput extends SchemaHandler>(schema: TInput) {
    return new Dispatch<Ctx, TInput, DispatchResolver<Ctx, TInput>>(
      this.middlewares,
      schema,
      this.resolver as any,
      this.config
    );
  }

  resolve<Resolver extends DispatchResolver<Ctx, InputSchema>>(
    resolver: Resolver
  ) {
    return new Dispatch<Ctx, InputSchema, Resolver>(
      this.middlewares,
      this.inputSchema,
      resolver,
      this.config
    );
  }

  consumerOptions(config: Partial<ConsumerOpts>) {
    return new Dispatch<Ctx, InputSchema, Resolver>(
      this.middlewares,
      this.inputSchema,
      this.resolver,
      deepmerge<DispatchConfig>(this.config || {}, { opts: config })
    );
  }

  async stop() {
    return await this.subscription?.drain();
  }

  async start(runtimeContext: RuntimeContext, subject: string) {
    if (!this.resolver) {
      throw new NTRPCError(
        "INTERNAL_ERROR",
        `No resolver defined for dispatch handler ${subject}`
      );
    }

    const sub = runtimeContext.nats.subscribe(subject, this.config?.opts);
    this.subscription = sub;

    (async () => {
      for await (const m of sub) {
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

            return res;
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
