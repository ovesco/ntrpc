import { z } from "zod";
import { init } from "./API";
import { Encoder } from "./encoders";
import { NatsConnection } from "nats";
import { Client } from "./client/Client";
import Namespace, { Procedures } from "./Namespace";
import Procedure from "./procedures/Procedure";

function ctx() {
  return {
    a: 1,
    b: "2",
  };
}

const yoEncoder: Encoder<String> = {
  encode: function (data: String): Uint8Array {
    throw new Error("Function not implemented.");
  },
  decode: function (data: Uint8Array): String {
    throw new Error("Function not implemented.");
  },
};

const encoders = { "yo/yo": yoEncoder };

const api = init().withContext<typeof ctx>().withEncoders<typeof encoders>();

const mp = api.procedure.middleware(async ({ ctx, next }) => {
  console.log("middleware", ctx);
  return await next({ ctx: { ...ctx, c: 2 } });
});

const r = api.namespace({
  yo: mp.dispatch
    .input(z.object({ yoyo: z.number() }))
    .resolve(async ({ ctx, input }) => {
      console.log("query", ctx, input);
    }),
  yo3: mp.query
    .input(z.object({ yoyo: z.number() }))
    .resolve(async ({ ctx, input }) => {
      console.log("query", ctx, input);
      return { a: 1 };
    }),
});

const rb = api.namespace({
  r,
  yo2: mp.query
    .input(z.object({ yoyo: z.number() }))
    // .responseEncoding("yo/yo")
    .resolve(async ({ ctx, input }) => {
      console.log("query", ctx, input);
      return { a: 1 };
    }),
});

const runner = api.getRunner({
  nats: null as unknown as NatsConnection,
  encoders,
  namespace: rb,
  contextBuilder: ctx,
});

runner.start();

const client = new Client<typeof runner>({
  nats: null as unknown as NatsConnection,
  encoders,
});

type A = typeof rb;

type InferProcedureType<T extends Procedure> = ReturnType<T["type"]>;

type B = InferProcedureType<A["procedures"]["yo2"]>;
