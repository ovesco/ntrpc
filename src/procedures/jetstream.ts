import { AckPolicy, nanos } from "nats";
import { RuntimeContext } from "../Runner";

/**
 * Checks if a stream exists for given name or creates it otherwise.
 * Checks that the stream includes the given subject or adds it otherwise.
 * @param runtimeContext the runtime context
 * @param name the name of the stream
 * @param subject the subject to add to the stream
 */
export async function setupStream(
  runtimeContext: RuntimeContext,
  name: string,
  subject: string
) {
  const jsm = await runtimeContext.nats.jetstreamManager();
  let foundStream = false;
  for await (const stream of jsm.streams.list()) {
    if (stream.config.name === name) {
      foundStream = true;
      // Found stream, update subject if necessary
      if (stream.config.subjects.includes(subject)) {
        runtimeContext.configuration.logger.debug("Stream already has subject");
      } else {
        runtimeContext.configuration.logger.debug("Adding subject to stream");
        await jsm.streams.update(name, {
          subjects: [...stream.config.subjects, subject],
        });
      }

      break;
    }
  }

  if (!foundStream) {
    runtimeContext.configuration.logger.debug("Stream not found, creating it");
    await jsm.streams.add({
      name,
      subjects: [subject],
    });
    runtimeContext.configuration.logger.debug("Stream created");
  }
}

/**
 * Returns a durable consumer for the given stream, name and subject.
 * If the consumer does not exist, it is created.
 * This consumer can then be shared among various instances to track
 * the stream and process messages without duplicates
 * @param runtimeContext the runtime context
 * @param stream the stream to get the consumer from
 * @param name the name of the consumer
 * @param subject the subject to filter messages on
 * @param timeout the timeout to wait for acks
 * @returns the consumer
 */
export async function getConsumerInfo(
  runtimeContext: RuntimeContext,
  stream: string,
  name: string,
  subject: string,
  timeout: number
) {
  const logger = runtimeContext.configuration.logger;
  logger.debug("Setup consumer start");
  const jsm = await runtimeContext.nats.jetstreamManager();

  for await (const consumer of jsm.consumers.list(stream)) {
    if (consumer.config.name === name) {
      logger.debug("Found corresponding consumer");
      return consumer;
    }
  }

  logger.debug("Consumer not found, creating it");
  const consumer = await jsm.consumers.add(stream, {
    name,
    durable_name: name,
    filter_subject: subject,
    ack_wait: nanos(timeout),
    ack_policy: AckPolicy.Explicit,
  });

  logger.debug({ consumer }, "Consumer created");
  return consumer;
}
