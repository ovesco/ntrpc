import { NTRPCError } from "./Error";
import Procedure from "./procedures/Procedure";
import { RunnerContext } from "./Runner";

// A namespace is a collection of procedures under the same name
// A namespace can contain other namespaces

export type Procedures = {
  [key: string]: Procedure | Namespace<Procedures>;
};

export default class Namespace<P extends Procedures = Procedures> {
  constructor(public readonly procedures: P) {}

  getProcedure(path: string[]): Procedure {
    const [part, ...remaining] = path;
    const { procedures } = this;
    if (part in procedures) {
      const procedure = procedures[part];
      if (procedure instanceof Namespace) {
        if (remaining.length > 0) {
          return procedure.getProcedure(remaining);
        } else {
          throw new NTRPCError(
            "PROCEDURE_NOT_FOUND",
            `Invalid path at ${part}, expected sub-namespace, got procedure`
          );
        }
      } else {
        if (remaining.length === 0) {
          return procedure;
        } else {
          throw new NTRPCError(
            "PROCEDURE_NOT_FOUND",
            `Invalid path given at ${part}, expected procedure got sub-namespace`
          );
        }
      }
    }

    throw new NTRPCError(
      "PROCEDURE_NOT_FOUND",
      `No procedure found at ${part} from ${path.join(".")}`
    );
  }

  async start(context: RunnerContext, currPath: string[] = []) {
    for (const key in this.procedures) {
      const element = this.procedures[key];
      if (element instanceof Namespace) {
        await element.start(context, [...currPath, key]);
      } else {
        const subject = `${currPath.join(".")}.${key}`;
        await element.start(context, subject);
      }
    }
  }

  async stop(context: RunnerContext, currPath: string[] = []) {
    const subject = currPath.join(".");
    context.configuration.logger.info(`Stopping namespace at [${subject}]`);
    for (const key in this.procedures) {
      const element = this.procedures[key];

      if (element instanceof Namespace) {
        await element.stop(context, [...currPath, key]);
      } else {
        const subject = `${currPath.join(".")}.${key}`;
        context.configuration.logger.info(`Stopping procedure ${element.type()} listening on [${subject}]`);
        await element.stop(context, subject);
      }
    }
  }
}
