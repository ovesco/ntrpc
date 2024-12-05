import { JsMsg, Msg } from "nats";
import { NTRPCError } from "../Error";
import { Context, Flatten, SchemaHandler, SchemaInferrer } from "../types";
import { ProcedureCallback } from "./Procedure";
import { getEnvelopeFromNatsMessage } from "../Envelope";
import deepmerge from "deepmerge";
import { RunnerContext } from "../Runner";

export type NextFunctionArgs<Ctx extends Context> = {
  ctx?: Ctx;
};

type NextFunctionReturnTypeOk = {
  type: "ok";
  output: any;
};

type NextFunctionReturnTypeError = {
  type: "error";
  error: NTRPCError;
};

export type NextFunctionReturnType<Ctx extends Context | undefined> = {
  ctx: Ctx;
} & (NextFunctionReturnTypeOk | NextFunctionReturnTypeError);

export type NextFunction = <
  NextCtx extends Context,
  Args extends NextFunctionArgs<NextCtx>
>(
  args?: Args
) => Promise<NextFunctionReturnType<Args["ctx"]>>;

export type MiddlewareFunctionParams<
  Ctx extends Context,
  Next extends NextFunction
> = {
  ctx: Ctx;
  next: Next;
};

export type InferNextContext<
  Ctx extends Context,
  Result extends NextFunctionReturnType<any>
> = Result extends { ctx: infer NextCtx } ? Flatten<Ctx & NextCtx> : Ctx;

export type Middleware<Ctx extends Context, Next extends NextFunction> = (
  params: MiddlewareFunctionParams<Ctx, Next>
) => ReturnType<Next>;

/**
 * Returns a function that unwraps the middlewares and executes the procedure action
 * @param runnerContext
 * @param middlewares the middlewares to unwrap
 * @returns a function that unwraps the middlewares and executes the procedure action
 */
export function buildMiddlewaresUnwrapper(
  runnerContext: RunnerContext,
  middlewares: Array<Middleware<any, any>>
) {
  return async function <
    M extends Msg | JsMsg,
    InputSchema extends SchemaHandler
  >(
    message: M,
    inputSchema: InputSchema,
    callback: ProcedureCallback<SchemaInferrer<InputSchema>>
  ) {
    const envelope = getEnvelopeFromNatsMessage(
      runnerContext.configuration,
      runnerContext.encoders,
      message,
      inputSchema
    );
    async function recursiveResolve<Ctx extends Context>(
      ctx: Ctx,
      middlewares: Middleware<any, any>[]
    ): Promise<NextFunctionReturnType<Ctx>> {
      if (middlewares.length === 0) {
        // Run the procedure action with the given context
        try {
          const res = await callback({ ctx, envelope });
          return {
            type: "ok",
            output: res,
            ctx,
          };
        } catch (actionError) {
          const error =
            actionError instanceof NTRPCError
              ? actionError
              : new NTRPCError(
                  "INTERNAL_ERROR",
                  "Error while unwrapping middlewares",
                  actionError
                );
          return {
            type: "error",
            error,
            ctx,
          };
        }
      }

      // Execute the middleware chain one after the other until
      // we can execute the procedure action and unwrap everything
      const [current, ...remaining] = middlewares;

      // The next function should call the next middleware and so on
      const next: NextFunction = async (args) => {
        const nextCtx = deepmerge<any>(args?.ctx || {}, ctx || {});
        return await recursiveResolve(nextCtx, remaining);
      };

      return await current({ next, ctx });
    }

    const baseCtx = await runnerContext.contextBuilder({
      message,
      envelope,
    });

    return recursiveResolve(baseCtx, middlewares);
  };
}
