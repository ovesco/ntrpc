import { nanoid } from "nanoid";

const instanceId = nanoid();

export type Configuration = {
  /**
   * Prefix string to all cloud event fields
   */
  natsHeadersPrefix: string;

  /**
   * A unique identifier for the service running ntRPC
   * This is used to identify the source of the event
   */
  instanceId: string;

  /**
   * Logger object
   * Should work out of the box with many different logging
   * libraries
   */
  logger: {
    debug: (data: any, msg?: string) => void;
    info: (data: any, msg?: string) => void;
    warn: (data: any, msg?: string) => void;
    error: (data: any, msg?: string) => void;
  };
};

export function getBaseConfiguration(): Configuration {
  return {
    natsHeadersPrefix: "ntrpc-",
    instanceId,
    logger: console,
  };
}
