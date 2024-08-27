import { Context } from "../types";

type StreamConfig = {
  streamName: string;
  consumerName: string;
};

/**
 * A stream procedure allows a client and server to stream data from one another.
 * This procedure is more complex than the other ones as it requires sending multiple
 * messages back and forth to keep track of the stream. It is also not possible to implement
 * load balancing on top of it.
 *
 * The protocol is the following:
 * - When a stream request is received, the server will create a new temporary consumer
 * without load balanding to handle the stream with a custom subject and send it to the client.
 * During the whole process, the server will notify nats that it's still working and is not
 * available to receive other stream requests
 * - When the client receives this data, it will start sending data to the server on the
 * custom subject.
 * - The server will then receive this data and process it.
 * - When done, the server will notify nats that it is available again
 */
export default class Stream<Ctx extends Context, >