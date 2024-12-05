import JSONEncoder from "./JSONEncoder";
import BinaryEncoder from "./BinaryEncoder";

/**
 * An encoder is responsible for encoding and decoding data to and from a
 * Uint8Array which is the format that is sent over Nats.
 *
 * An application can implement this interface to provide custom encoding and
 * decoding logic.
 */
export interface Encoder<T> {
  encode(data: T): Uint8Array;
  decode(data: Uint8Array): T;
}

export type EncoderMime = `${string}/${string}`
export type Encoders = Record<EncoderMime, Encoder<unknown>>;

const baseEncoders = {
  "application/json": JSONEncoder,
  "application/octet-stream": BinaryEncoder,
};

export type BaseEncoders = typeof baseEncoders;

export { JSONEncoder, BinaryEncoder, baseEncoders };
