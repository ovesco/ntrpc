import { NatsConnection } from "nats";
import { Encoders } from "../encoders";
import Namespace, { Procedures } from "../Namespace";
import Runner from "../Runner";
import { ContextBuilder } from "../types";
import Procedure from "../procedures/Procedure";
import Query from "../procedures/Query";
import { z, ZodNever, ZodType } from "zod";
import Dispatch from "../procedures/Dispatch";
import Queue from "../procedures/Queue";


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


type InferQueryInput<Q> = Q extends Query<any, any, any, infer Input, any>
  ? Input extends ZodType<any, any, any> ? z.infer<Input> : never : never;
type InferQueryOutput<Q> = Q extends Query<any, any, any, any, infer Output> ? Awaited<ReturnType<Output>> : never;

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

type ClientConfig<
  R extends Runner<
    Namespace<Procedures>,
    ContextBuilder | undefined,
    Encoders | undefined
  >
> = {
  nats: NatsConnection;
} & ConditionalEncoders<R>;

export class Client<
  R extends Runner<
    Namespace<Procedures>,
    ContextBuilder | undefined,
    Encoders | undefined
  >
> {

  constructor(private config: ClientConfig<R>) {}

  async query<K extends keyof InferProcedures<R['namespace'], 'query'>, Q extends InferProcedures<R['namespace'], 'query'>[K]>(subject: K, ...[data]: InferQueryInput<Q> extends never ? [] : [InferQueryInput<Q>]): Promise<InferQueryOutput<Q>> {
    
  }

  async dispatch<K extends keyof InferProcedures<R['namespace'], 'dispatch'>, D extends InferProcedures<R['namespace'], 'dispatch'>[K]>(subject: K, ...[data]: InferDispatchInput<D> extends never ? [] : [InferDispatchInput<D>]) {

  }

  async queue<K extends keyof InferProcedures<R['namespace'], 'queue'>, D extends InferProcedures<R['namespace'], 'queue'>[K]>(subject: K, ...[data]: InferQueueInput<D> extends never ? [] : [InferQueueInput<D>]) {

  }
}
