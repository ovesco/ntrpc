import { DataStore, NatsDataStore } from "./DataStore";
import { NatsConnection } from "nats";
import { baseEncoders, BaseEncoders, Encoders } from "./encoders";
import ProcedureBuilder from "./procedures/Builder";
import Namespace, { Procedures } from "./Namespace";
import { ContextBuilder, DeepPartial, InferredContext } from "./types";
import { Configuration, getBaseConfiguration } from "./Configuration";
import deepmerge from "deepmerge";
import Runner from "./Runner";

type EncodersOrUndefined = Encoders | undefined;
type ContextBuilderOrUndefined = ContextBuilder | undefined;

type InferredContextBuilder<CB extends ContextBuilderOrUndefined> =
  CB extends ContextBuilder ? CB : () => {};

type InferredEncoders<E extends EncodersOrUndefined> = E extends Encoders
  ? BaseEncoders & E
  : BaseEncoders;

type BuildRuntimeConfig<
  N extends Namespace<Procedures>,
  CB extends ContextBuilderOrUndefined,
  E extends EncodersOrUndefined
> = {
  nats: NatsConnection;
  configuration?: DeepPartial<Configuration>;
  dataStore?: DataStore;
  namespace: N;
} & ConditionalEncoders<E> &
  ConditionalContextBuilder<CB>;

type ConditionalContextBuilder<CB extends ContextBuilderOrUndefined> =
  CB extends ContextBuilder ? { contextBuilder: CB } : {};

type ConditionalEncoders<E extends EncodersOrUndefined> = E extends Encoders
  ? { encoders: E }
  : {};

class API<
  CB extends ContextBuilderOrUndefined,
  EU extends EncodersOrUndefined
> {
  withContext<C extends ContextBuilder>() {
    return new API<C, EU>();
  }

  withEncoders<E extends Encoders>() {
    return new API<CB, E>();
  }

  get procedure() {
    return new ProcedureBuilder<
      InferredContext<InferredContextBuilder<CB>>,
      InferredEncoders<EU>
    >();
  }

  namespace<P extends Procedures>(procedures: P) {
    return new Namespace(procedures);
  }

  getRunner<N extends Namespace<Procedures>>(
    runtimeConfig: BuildRuntimeConfig<N, CB, EU>
  ) {
    const configuration = deepmerge(
      getBaseConfiguration(),
      runtimeConfig.configuration || {}
    ) as Configuration;

    const givenContextBuilder =
      "contextBuilder" in runtimeConfig
        ? runtimeConfig.contextBuilder
        : undefined;

    return new Runner<N, CB, EU>(
      {
        nats: runtimeConfig.nats,
        configuration,
        dataStore:
          runtimeConfig.dataStore ||
          new NatsDataStore(runtimeConfig.nats, configuration),
        contextBuilder: givenContextBuilder as any,
        encoders:
          "encoders" in runtimeConfig ? runtimeConfig.encoders : ({} as any),
      },
      runtimeConfig.namespace
    );
  }
}

export function init() {
  return new API<undefined, undefined>();
}
