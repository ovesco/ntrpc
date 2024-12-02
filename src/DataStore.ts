import { KV, NatsConnection, StringCodec } from "nats";
import { init } from "./API";
import { Configuration } from "./Configuration";

/**
 * A DataStore must allow to store and retrieve data in a key-value fashion.
 * It should be used to store data that needs to be shared between procedures.
 * Note that the data store should be persisted on disk in case of crash.
 */
export interface DataStore {
  /**
   * Initialize the data store if necessary
   */
  init?(): Promise<void>;

  /**
   * Set a value in the data store
   * @param key The key to store the value under
   * @param value The value to store
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Get a value from the data store
   * @param key The key to get the value from
   * @returns The value stored under the key
   */
  get<K extends string>(key: string): Promise<K | undefined>;

  /**
   * Delete a value from the data store
   * @param key The key to delete
   */
  del(key: string): Promise<void>;
}

const codec = StringCodec();

/**
 * A DataStore implementation that uses NATS KV as data store
 */
export class NatsDataStore implements DataStore {
  private _kv: KV | undefined;

  constructor(private nats: NatsConnection, private config: Configuration) {}

  async init() {
    this._kv = await this.nats.jetstream().views.kv(this.config.instanceId);
  }

  get kv() {
    if (!this._kv) {
      throw new Error("DataStore not initialized");
    }

    return this._kv;
  }

  async set(key: string, value: string) {
    await this.kv.put(key, codec.encode(value));
  }

  async get<Val extends string>(key: string) {
    const val = await this.kv.get(key);
    if (!val) {
      return undefined;
    }

    // Do not return anything if the value was deleted
    if (val?.operation === "DEL" || val?.operation === "PURGE") {
      return undefined;
    }

    return codec.decode(val.value) as Val;
  }

  async del(key: string) {
    await this.kv.delete(key);
  }
}
