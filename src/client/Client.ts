import { NatsConnection } from "nats";
import { Encoders } from "../encoders";
import Namespace, { Procedures } from "../Namespace";
import Runner from "../Runner";
import { ContextBuilder } from "../types";

type ExpandRecursively<N extends Namespace<Procedures>> = {
  [K in keyof N["procedures"]]: N["procedures"][K] extends Namespace<Procedures>
    ? ExpandRecursively<N["procedures"][K]>
    : N["procedures"][K];
};

type RemapKeys<T extends Namespace<Procedures>> = ExpandRecursively<
  { [K in keyof T]: (x: NestedRecord<K, T[K]>) => void } extends Record<
    string,
    (x: infer I) => void
  >
    ? I
    : never
>;

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
}
