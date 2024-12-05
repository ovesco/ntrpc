import { Msg, NatsConnection, RequestOptions } from "nats";
import { baseEncoders, BaseEncoders, EncoderMime, Encoders } from "../encoders";
import Namespace, { Procedures } from "../Namespace";
import Runner from "../Runner";
import { ContextBuilder, NanoID } from "../types";
import Procedure from "../procedures/Procedure";
import Query from "../procedures/Query";
import { z, ZodNever, ZodType } from "zod";
import Dispatch from "../procedures/Dispatch";
import Queue from "../procedures/Queue";
import { Configuration } from "../Configuration";
import queryCaller from "./QueryCaller";
import deepmerge from "deepmerge";
import { Envelope, getDefaultNatsHeaders } from "../Envelope";


type InferProcedures<T extends Namespace, type extends 'query' | 'queue' | 'dispatch'> = FlattenFields<T['procedures'], type>;

type PrependKey<K extends PropertyKey, T> =
   { [P in Exclude<keyof T, symbol> as
      `${Exclude<K, symbol>}.${P}`]: T[P] };

type FlattenFields<T extends Procedures, type extends 'query' | 'queue' | 'dispatch'> = { [K in keyof T]: (x:
  (T[K] extends Procedure ?
    ReturnType<T[K]['type']> extends type ? Record<K, T[K]> : unknown : unknown) &
  (T[K] extends Namespace ?
     PrependKey<K, InferProcedures<T[K], type>>
     : unknown)
) => void }[keyof T] extends (x: infer I) => void ?
  { [K in keyof I]: I[K] } : never;


/* Query */
type InferQueryInput<Q> = Q extends Query<any, any, any, infer Input, any>
  ? Input extends ZodType<any, any, any> ? z.infer<Input> : never : never;
type InferQueryOutput<Q> = Q extends Query<any, any, any, any, infer Output> ? Awaited<ReturnType<Output>> : never;

export type QueryCallerConfig = {
  encoding: EncoderMime;
  parentId?: NanoID;
  requestOptions?: RequestOptions;
};

type ResponseEnvelope<T> = Envelope<T> & {
  msg: Msg;
};

/* Dispatch */
type InferDispatchInput<Q> = Q extends Dispatch<any, infer Input, any>
  ? Input extends ZodType<any, any, any> ? Input extends ZodNever ? undefined : z.infer<Input> : never : never;

type InferQueueInput<Q> = Q extends Queue<any, infer Input>
  ? Input extends ZodType<any, any, any> ? z.infer<Input> : never : never;

type ConditionalEncoders<
  R extends Runner<
    Namespace<Procedures>,
    ContextBuilder | undefined,
    Encoders | undefined
  >
> = R extends Runner<Namespace<Procedures>, ContextBuilder, infer E>
  ? E extends Encoders
    ? { encoders: E }
    : {}
  : {};

export type PartialClientRuntime<
  R extends Runner<
    Namespace<Procedures>,
    ContextBuilder | undefined,
    Encoders | undefined
  > = any
> = {
  nats: NatsConnection;
  configuration: Configuration;
} & ConditionalEncoders<R>;

export type ClientRuntime<
  R extends Runner<
    Namespace<Procedures>,
    ContextBuilder | undefined,
    Encoders | undefined
  > = any
> = PartialClientRuntime<R> & {
  encoders: Encoders;
}

export class Client<
  R extends Runner<
    Namespace<Procedures>,
    ContextBuilder | undefined,
    Encoders | undefined
  >
> {

  private runtime: ClientRuntime<R>;

  constructor(config: PartialClientRuntime<R>) {
    this.runtime = {
      encoders: baseEncoders,
      ...config,
    };
  }

  async query<K extends keyof InferProcedures<R['namespace'], 'query'>, Q extends InferProcedures<R['namespace'], 'query'>[K]>(subject: K, ...[data]: InferQueryInput<Q> extends never ? [QueryCallerConfig?] : [InferQueryInput<Q>, QueryCallerConfig?]): Promise<ResponseEnvelope<InferQueryOutput<Q>>> {
    
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

  async dispatch<K extends keyof InferProcedures<R['namespace'], 'dispatch'>, D extends InferProcedures<R['namespace'], 'dispatch'>[K]>(subject: K, ...[data]: InferDispatchInput<D> extends never ? [] : [InferDispatchInput<D>]) {

  }

  async queue<K extends keyof InferProcedures<R['namespace'], 'queue'>, D extends InferProcedures<R['namespace'], 'queue'>[K]>(subject: K, ...[data]: InferQueueInput<D> extends never ? [] : [InferQueueInput<D>]) {

  }

  private getDefaultConfig(runtime: ClientRuntime, subject: string, givenConfig?: QueryCallerConfig): QueryCallerConfig {

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
}
