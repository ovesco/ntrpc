import { NatsConnection } from "nats";
import { Configuration } from "./Configuration";
import { BaseEncoders, Encoders } from "./encoders";
import { ContextBuilder } from "./types";
import { DataStore } from "./DataStore";

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
  N,
  C extends ContextBuilder | undefined,
  E extends Encoders | undefined
> {
  constructor(
    private runtimeContext: RuntimeContext<C, E>,
    private namespaces: N
  ) {}

  /**
   * Starts the runner
   */
  async start() {
    console.log("Starting runner");
  }
}
