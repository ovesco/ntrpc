import { z } from "zod";
import { init } from "./API";
import { Encoder } from "./encoders";
import { NatsConnection } from "nats";
import { Client } from "./client/Client";
import { NTRPCError } from "./Error";

async function contextProvider() {
  return {
    a: 1,
    b: "2",
  };
}

const myBasicEncoder: Encoder<Uint8Array> = {
  encode: function (data: Uint8Array): Uint8Array {
    return data;
  },
  decode: function (data: Uint8Array): Uint8Array {
    return data;
  },
};

const encoders = { "hochet/binary": myBasicEncoder };
const n = init().withContext<typeof contextProvider>().withEncoders<typeof encoders>();

const middleware = n.procedure.middleware(async ({ ctx, next }) => {
  return await next({ ctx: { ...ctx, hasUser: true } });
});

const authMiddleware = middleware.middleware(async ({ ctx, next }) => {
  if (!ctx.hasUser) {
    throw new NTRPCError("INVALID_REQUEST", "No user found");
  }

  return await next({ ctx: { ...ctx, middlewareData: true, userId: 10 } });
});

const authNamespace = n.namespace({
  getProfilePicture: authMiddleware.query
  .responseEncoding("hochet/binary")
  .resolve(async () => {
    return new Uint8Array();
  }),

  setUsername: authMiddleware.query
    .input(z.object({ username: z.string() }))
    .resolve(async ({ ctx, input, envelope }) => {
      const time = envelope.time;
      const userId = ctx.userId;
      // Do some update
      return { username: input.username, userId: ctx.userId };
    }),
  disconnect: authMiddleware.dispatch
    .resolve(async ({ ctx }) => {
      // Do something
    }),
});

const globalNamespace = n.namespace({
  auth: authNamespace,

  setLogo: middleware.queue
    .input(z.instanceof(Uint8Array))
    .resolve(async ({ input }) => {
      // Do something with the binary
    }),
});

const runner = n.getRunner({
  nats: null as unknown as NatsConnection,
  encoders,
  namespace: globalNamespace,
  contextBuilder: contextProvider,
});

const client = new Client<typeof runner>({
  nats: null as unknown as NatsConnection,
  encoders,
});


const userData = client.query('auth.setUsername', { username: 'hochetus' });
const profilePicBinary = client.query('auth.getProfilePicture', {
  encoding: ''
});

// Note as we do not need to provide a payload argument here
client.dispatch('auth.disconnect');

client.queue('setLogo', new Uint8Array());