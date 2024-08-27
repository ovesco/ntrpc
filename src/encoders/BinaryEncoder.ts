import { Encoder } from ".";

const BinaryEncoder: Encoder<Uint8Array> = {
  encode: (data) => data,
  decode: (data) => data,
};

export default BinaryEncoder;
