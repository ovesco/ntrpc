import deepmerge from "deepmerge";
import { EncoderMime } from "../encoders";
import { Envelope, getDefaultNatsHeaders, getEnvelopeFromNatsMessage } from "../Envelope"
import { NanoID } from "../types";
import { Msg, RequestOptions } from "nats";
import { NTRPCError } from "../Error";
import { ClientRuntime } from "./Client";

export type QueryCallerConfig = {
  encoding: EncoderMime;
  parentId?: NanoID;
  requestOptions?: RequestOptions;
};

type ResponseEnvelope<T> = Envelope<T> & {
  msg: Msg;
};

function getDefaultConfig(runtime: ClientRuntime, subject: string, givenConfig?: QueryCallerConfig): QueryCallerConfig {

  const config = deepmerge({
    encoding: "application/json",
    requestOptions: {
      timeout: 15 * 1000,
    }
  }, givenConfig || {});

  const headers = getDefaultNatsHeaders(runtime.configuration, subject, config.encoding, config.parentId);
  if (givenConfig?.requestOptions?.headers) {
    for (const [name, value] of givenConfig.requestOptions.headers) {
      for (const val of value) {
        headers.append(name, val);
      }
    }
  }

  config.requestOptions.headers = headers;
  return config;
}

export default async function queryCaller<T>(runtime: ClientRuntime, subject: string, payload: any, opts?: QueryCallerConfig): Promise<ResponseEnvelope<T>> {
  opts = getDefaultConfig(runtime, subject, opts);
  const encodedPayload = runtime.encoders[opts.encoding].encode(payload);

  try {
    const res = await runtime.nats.request(subject, encodedPayload, opts.requestOptions);
    const envelope = getEnvelopeFromNatsMessage(runtime, res);
    if (envelope.status === 'error') {
      throw envelope.data;
    }

    return {
      ...envelope,
      msg: res,
    };
  } catch (error) {
    throw new NTRPCError("INTERNAL_ERROR", "Error sending request", error);
  }
}