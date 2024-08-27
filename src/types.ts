import { JsMsg, Msg } from "nats";
import { Envelope } from "./Envelope";
import { z, ZodType } from "zod";

export type NanoID = string;

type Json =
  | string
  | number
  | boolean
  | null
  | { [property: string]: Json }
  | Json[];

export type Context = { [key: string]: Json };

export type ContextBuilderParams = {
  message: Msg | JsMsg;
  envelope: Envelope<unknown>;
};

export type ContextBuilder<Ctx extends Context = Context> = (
  params: ContextBuilderParams
) => Ctx | Promise<Ctx>;

export type Unwrap<T> = T extends (...args: any[]) => any ? ReturnType<T> : T;

export type FunctionSchemaHandler = (val: unknown) => unknown;
export type SchemaHandler = ZodType | FunctionSchemaHandler | undefined;

export type SchemaInferrer<Input extends SchemaHandler> = Input extends ZodType
  ? z.infer<Input>
  : Input extends FunctionSchemaHandler
  ? Unwrap<Input>
  : never;

export type ProcedureHandlerParams<
  Ctx extends Context,
  InputSchema extends SchemaHandler,
  M extends Msg | JsMsg
> = {
  ctx: Ctx;
  input: SchemaInferrer<InputSchema>;
  envelope: Envelope<SchemaInferrer<InputSchema>>;
  message: M;
};

export type Flatten<T> = T extends Record<string, any>
  ? { [k in keyof T]: T[k] }
  : never;
