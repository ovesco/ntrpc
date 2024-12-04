import { NatsConnection } from "nats";
import { Configuration } from "./Configuration";
import { BaseEncoders, Encoders } from "./encoders";
import { ContextBuilder } from "./types";
import { DataStore } from "./DataStore";
import Namespace, { Procedures } from "./Namespace";

/**
 * The runtime context represents the global context required to run procedures
 */
export class RuntimeContext<
  C extends ContextBuilder | undefined = ContextBuilder,
  E extends Encoders | undefined = Encoders
> {
  constructor(
    public readonly nats: NatsConnection,
    public readonly configuration: Configuration,
    public readonly dataStore: DataStore,
    public readonly contextBuilder: C,
    public readonly encoders: BaseEncoders & E
  ) {}
}

/**
 * The runtime is the main entry point for the NTRPC framework.
 */
export default class Runner<
  N extends Namespace,
  C extends ContextBuilder | undefined,
  E extends Encoders | undefined
> {
  constructor(
    private runtimeContext: RuntimeContext<C, E>,
    public readonly namespace: N
  ) {}

  /**
   * Starts the runner
   */
  async start() {
    const logger = this.runtimeContext.configuration.logger;
    logger.debug(`Starting nTRPC Runner`);
    await this.namespace.start(this.runtimeContext as RuntimeContext);
    logger.info(`nTRPC running`);
  }

  async stop() {
    const logger = this.runtimeContext.configuration.logger;
    logger.debug(`Stopping nTRPC Runner`);
    await this.namespace.stop(this.runtimeContext as RuntimeContext);
    logger.info(`nTRPC stopped`);

  }
}
