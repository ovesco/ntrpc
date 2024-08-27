import { StringCodec } from "nats";
import { Encoder } from ".";

const sc = StringCodec();

const JSONEncoder: Encoder<Object> = {
  encode: (data) => sc.encode(JSON.stringify(data)),
  decode: (data) => JSON.parse(sc.decode(data)),
};

export default JSONEncoder;
