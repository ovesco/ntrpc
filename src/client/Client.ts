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
import deepmerge from "deepmerge";
import {
  Envelope,
  getDefaultNatsHeaders,
  getEnvelopeFromNatsMessage,
} from "../Envelope";
import { NTRPCError } from "../Error";

type InferProcedures<
  T extends Namespace,
  type extends "query" | "queue" | "dispatch"
> = FlattenFields<T["procedures"], type>;

type PrependKey<K extends PropertyKey, T> = {
  [P in Exclude<keyof T, symbol> as `${Exclude<K, symbol>}.${P}`]: T[P];
};

type FlattenFields<
  T extends Procedures,
  type extends "query" | "queue" | "dispatch"
> = {
  [K in keyof T]: (
    x: (T[K] extends Procedure
      ? ReturnType<T[K]["type"]> extends type
        ? Record<K, T[K]>
        : unknown
      : unknown) &
      (T[K] extends Namespace
        ? PrependKey<K, InferProcedures<T[K], type>>
        : unknown)
  ) => void;
}[keyof T] extends (x: infer I) => void
  ? { [K in keyof I]: I[K] }
  : never;

type BaseRunner = Runner<
  Namespace<Procedures>,
  ContextBuilder | undefined,
  Encoders | undefined
>;

/* Query */
type InferQueryInput<Q> = Q extends Query<any, any, any, infer Input, any>
  ? Input extends ZodType<any, any, any>
    ? z.infer<Input>
    : never
  : never;
type InferQueryOutput<Q> = Q extends Query<any, any, any, any, infer Output>
  ? Awaited<ReturnType<Output>>
  : never;

export type QueryCallerConfig<
  R extends Runner<
    Namespace<Procedures>,
    ContextBuilder | undefined,
    Encoders | undefined
  >
> = {
  encoding: keyof InferRouterEncoders<R>;
  parentId?: NanoID;
  requestOptions?: RequestOptions;
};

type ResponseEnvelope<T> = Envelope<T> & {
  msg: Msg;
};

const QueryCallerConfigSchema = z.object({
  encoding: z.string(),
  parentId: z.string().optional(),
  requestOptions: z.any().optional(),
});

/* Dispatch */
type InferDispatchInput<Q> = Q extends Dispatch<any, infer Input, any>
  ? Input extends ZodType<any, any, any>
    ? Input extends ZodNever
      ? undefined
      : z.infer<Input>
    : never
  : never;

type InferQueueInput<Q> = Q extends Queue<any, infer Input>
  ? Input extends ZodType<any, any, any>
    ? z.infer<Input>
    : never
  : never;

type ConditionalEncoders<R extends BaseRunner> = R extends Runner<
  Namespace<Procedures>,
  ContextBuilder,
  infer E
>
  ? E extends Encoders
    ? { encoders: E }
    : {}
  : {};

export type PartialClientContext = {
  nats: NatsConnection;
  configuration?: Configuration;
};

type InferRouterEncoders<R extends BaseRunner = any> = R extends Runner<
  any,
  any,
  infer E
>
  ? BaseEncoders & E
  : BaseEncoders;

export type ClientContext<R extends BaseRunner = any> = {
  nats: NatsConnection;
  configuration: Configuration;
  encoders: NonNullable<InferRouterEncoders<R>>;
};

export class Client<R extends BaseRunner> {
  private context: ClientContext<R>;

  constructor(config: PartialClientContext & ConditionalEncoders<R>) {
    this.context = {
      encoders: baseEncoders as any,
      ...config,
    } as ClientContext<R>;
  }

  async query<
    K extends keyof InferProcedures<R["namespace"], "query">,
    Q extends InferProcedures<R["namespace"], "query">[K]
  >(
    subject: string & K,
    ...[data]: InferQueryInput<Q> extends never
      ? [QueryCallerConfig<R>?]
      : [InferQueryInput<Q>, QueryCallerConfig<R>?]
  ): Promise<ResponseEnvelope<InferQueryOutput<Q>>> {
    const [payload, givenOpts] = this.splitArgs(
      [data],
      QueryCallerConfigSchema
    );
    const opts = this.getDefaultConfig(subject, givenOpts);
    const encodedPayload =
      this.context.encoders[opts.encoding as keyof Encoders].encode(payload);

    try {
      const res = await this.context.nats.request(
        subject,
        encodedPayload,
        opts.requestOptions
      );
      const envelope = getEnvelopeFromNatsMessage(
        this.context.configuration,
        this.context.encoders,
        res
      );
      if (envelope.status === "error") {
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

  async dispatch<
    K extends keyof InferProcedures<R["namespace"], "dispatch">,
    D extends InferProcedures<R["namespace"], "dispatch">[K]
  >(
    subject: K,
    ...[data]: InferDispatchInput<D> extends never
      ? []
      : [InferDispatchInput<D>]
  ) {}

  async queue<
    K extends keyof InferProcedures<R["namespace"], "queue">,
    D extends InferProcedures<R["namespace"], "queue">[K]
  >(
    subject: K,
    ...[data]: InferQueueInput<D> extends never ? [] : [InferQueueInput<D>]
  ) {}

  private getDefaultConfig(
    subject: string,
    givenConfig?: QueryCallerConfig<R>
  ): QueryCallerConfig<R> {
    const config = deepmerge(
      {
        encoding: "application/json",
        requestOptions: {
          timeout: 15 * 1000,
        },
      },
      givenConfig || {}
    );

    const headers = getDefaultNatsHeaders(
      this.context.configuration,
      subject,
      config.encoding as EncoderMime,
      config.parentId
    );
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

  private splitArgs(data: [any?, object?], schema: z.ZodType<any>) {
    if (data.length === 2) {
      return [data[0], data[1]];
    }

    if (data.length === 0) {
      return [undefined, undefined];
    }

    const item = data[0];
    // Make sure the item is a nats opts
    if (schema.safeParse(item).success) {
      return [undefined, item];
    }

    return [data[0], undefined];
  }
}
