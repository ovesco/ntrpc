import { NatsConnection } from "nats";
import { Configuration } from "./Configuration";
import { Encoders } from "./encoders";
import { ContextBuilder } from "./types";
import { DataStore } from "./DataStore";

/**
 * The runtime context represents the global context required to run procedures
 */
export class RuntimeContext {
  constructor(
    public readonly nats: NatsConnection,
    public readonly configuration: Configuration,
    public readonly dataStore: DataStore,
    public readonly contextBuilder: ContextBuilder,
    public readonly encoders: Encoders
  ) {}
}
