import { Context } from "../types";
import { InferNextContext, Middleware, NextFunction } from "./Middleware";
import { BaseEncoders } from "../encoders";
import Query from "./Query";
import Queue from "./Queue";
import Dispatch from "./Dispatch";

export default class ProcedureBuilder<
  Ctx extends Context,
  Encoders extends BaseEncoders
> {
  constructor(private middlewares: Middleware<any, any>[] = []) {}

  /**
   * Registers a new middleware in the procedure chain
   * @param middleware
   * @returns
   */
  middleware<Next extends NextFunction, M extends Middleware<Ctx, Next>>(
    middleware: M
  ) {
    return new ProcedureBuilder<
      InferNextContext<Ctx, Awaited<ReturnType<M>>>,
      Encoders
    >([...this.middlewares, middleware]);
  }

  /**
   * Returns a middleware-aware query procedure builder
   */
  get query() {
    return new Query<Ctx, Encoders, "application/json", never, never>(
      this.middlewares,
      undefined,
      undefined
    );
  }

  /**
   * Returns a middleware-aware queue procedure builder
   */
  get queue() {
    return new Queue<Ctx, never>(this.middlewares, undefined, undefined);
  }

  /**
   * Returns a middleware-aware dispatch procedure builder
   */
  get dispatch() {
    return new Dispatch<Ctx, never>(this.middlewares, undefined, undefined);
  }
}
