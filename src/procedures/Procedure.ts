import { Envelope } from "../Envelope";
import { RunnerContext } from "../Runner";
import { Context } from "../types";
import { Middleware } from "./Middleware";

type ProcedureCallbackArgs<T> = {
  ctx: Context;
  envelope: Envelope<T>;
};

export type ProcedureCallback<T = unknown> = (
  args: ProcedureCallbackArgs<T>
) => any;

/**
 * a Procedure is an object that runs for as long as the server is running.
 * It listens for new Nats messages on given subjects and runs the given callback
 * after having unwrapped any middleware that was attached to it.
 *
 * Procedures can define how they listen to subjects, either with jetstream, doing
 * custom and fancy stuff, or just plain old nats.
 */
export default abstract class Procedure {
  constructor(protected middlewares: Array<Middleware<any, any>>) {}

  abstract type(): "query" | "queue" | "dispatch";

  /**
   * Starts the given procedure
   * @param runnerContext the runtime context
   * @param subject the subject to listen to
   */
  abstract start(
    runnerContext: RunnerContext,
    subject: string
  ): Promise<void>;

  /**
   * Stops the given procedure, clearing any nats listener and freeing up resources
   */
  abstract stop(runnerContext: RunnerContext, subject: string): Promise<void>;
}
