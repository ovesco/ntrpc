import { z, ZodSchema, ZodUnknown } from "zod";
import { Configuration } from "./Configuration";
import {
  FunctionSchemaHandler,
  NanoID,
  SchemaHandler,
  SchemaInferrer,
  Unwrap,
} from "./types";
import { headers, JsMsg, Msg } from "nats";
import { nanoid } from "nanoid";
import { NTRPCError } from "./Error";
import { RuntimeContext } from "./Runner";

/**
 * An envelope wraps the data sent over the network, following the Cloud event
 * spec.
 */
export interface Envelope<T = never> {
  /**
   * A unique identifier attached to each envelope
   * This identifier IS propagated in the case of a request-response pattern
   */
  id: NanoID;

  /**
   * If this message is a response to another message, this field should be set
   * to the id of the message to which this is a response
   */
  parentId?: NanoID;

  /**
   * The actual subject on which this envelope was sent
   */
  subject: string;

  /**
   * The name of the service which sent this envelope
   */
  source: string;
  specversion: "1.0";

  /**
   * The handler path which this envelope is linked to when known
   * Set to the same value as subject from the client side
   */
  type: string;

  /**
   * THe mime type for the content of this envelope
   * By default is application/json
   */
  datacontenttype: `${string}/${string}`;
  time: string; // ISO 8601 date without timezone

  /**
   * Actual data payload, encoded accordingly to the datacontenttype
   */
  data: T;
}

export const EnvelopeSchema = z.object({
  id: z.string().nanoid(),
  parentId: z.string().nanoid().optional(),
  source: z.string(),
  specversion: z.literal("1.0"),
  type: z.string(),
  datacontenttype: z.string().refine((val) => val.split("/").length === 2, {
    message: "datacontenttype must be a valid mime type",
  }),
  time: z.string().datetime(),
});

/**
 * Builds default nats headers to represent an envelope
 * @param config Configuration object
 * @param type The type of the envelope
 * @param contentType The content type of the envelope
 * @param parentId The id of a received envelope if this is a response
 * @returns A headers object with the default nats headers
 */
export function getDefaultNatsHeaders(
  config: Configuration,
  type: string,
  contentType: `${string}/${string}`,
  parentId?: NanoID
) {
  const h = headers();
  const prefix = config.natsHeadersPrefix;
  h.append(`${prefix}id`, nanoid());

  if (parentId) {
    h.append(`${prefix}parent-id`, parentId);
  }

  h.append(`${prefix}source`, config.instanceId);
  h.append(`${prefix}specversion`, "1.0");
  h.append(`${prefix}type`, type);
  h.append(`${prefix}time`, new Date().toISOString());
  h.append(`${prefix}datacontenttype`, contentType);
  return h;
}

/**
 * Builds an envelope object from a nats message
 * @param config The configuration object
 * @param encoders Available encoders
 * @param msg The nats message
 * @param schema The schema to validate the envelope's schema against
 * @returns The envelope object
 */
export function getEnvelopeFromNatsMessage<
  S extends SchemaHandler,
  T extends SchemaInferrer<S>
>(runtimeContext: RuntimeContext, msg: Msg | JsMsg, schema: S): Envelope<T> {
  const headers = msg.headers;
  if (!headers) {
    throw new Error("No headers found on message");
  }

  const prefix = runtimeContext.configuration.natsHeadersPrefix;
  const datacontenttype = headers.get(
    `${prefix}datacontenttype`
  ) as `${string}/${string}`;

  if (!Object.keys(runtimeContext.encoders).includes(datacontenttype)) {
    throw new NTRPCError(
      "INVALID_DATA",
      `No encoder can handle received envelope of type ${datacontenttype}`
    );
  }

  const envelope = {
    subject: msg.subject,
    id: headers.get(`${prefix}id`),
    parentId: headers.has(`${prefix}parent-id`)
      ? headers.get(`${prefix}parent-id`)
      : undefined,
    source: headers.get(`${prefix}source`),
    specversion: headers.get(
      `${prefix}specversion`
    ) as Envelope<T>["specversion"],
    type: headers.get(`${prefix}type`),
    time: headers.get(`${prefix}time`),
    datacontenttype,
    data: runtimeContext.encoders[datacontenttype].decode(msg.data) as T,
  };

  validate<S>(envelope, schema);
  return envelope;
}

/**
 * Validates an envelope against a zod schema
 * @param envelope the envelope to validate
 * @param payloadSchema the schema to validate the envelope's payload against
 */
function validateZodSchema<S extends ZodSchema = ZodUnknown>(
  envelope: Envelope<z.infer<S>>,
  payloadSchema?: S
) {
  const dataPayloadSchema = payloadSchema ?? z.unknown();
  const result = EnvelopeSchema.extend({
    data: dataPayloadSchema,
  }).safeParse(envelope);
  if (!result.success) {
    throw new NTRPCError("INVALID_DATA", result.error.message, result.error);
  }
}

/**
 * Validate an envelope with a given function to validate its payload
 * @param envelope the envelope to validate
 * @param validator the function to validate the payload
 */
function validateFunctionSchema<S extends FunctionSchemaHandler>(
  envelope: Envelope<Unwrap<S>>,
  validator: S
) {
  // Validate envelope first
  validateZodSchema(envelope, z.any());

  // Validate custom function
  // Should throw an error if problem
  try {
    validator(envelope.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid data";
    throw new NTRPCError("INVALID_DATA", message, error);
  }
}

/**
 * Validates an envelope against the given schema or validator function
 * @param envelope the envelope to validate
 * @param payloadSchema the schema or function to validate the envelope's payload against
 * @returns the envelope if it is valid
 */
export function validate<S extends SchemaHandler>(
  envelope: Envelope<SchemaInferrer<S>>,
  payloadSchema: S
) {
  if (!payloadSchema) {
    return validateZodSchema(envelope, z.any());
  } else if (typeof payloadSchema === "function") {
    validateFunctionSchema(envelope, payloadSchema);
  } else {
    validateZodSchema(envelope, payloadSchema);
  }
}
