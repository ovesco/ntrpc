const ERROR_CODES = [
  "INVALID_DATA",
  "INVALID_REQUEST",
  "PROCEDURE_NOT_FOUND",
  "INVALID_METHOD_PARAMS",
  "INTERNAL_ERROR",
  "UNKNOWN_DATA_TYPE",
  "UNKNOWN_ENCODER",
] as const;

class NTRPCError extends Error {
  constructor(
    public readonly code: (typeof ERROR_CODES)[number],
    message?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
  }
}

export { NTRPCError, ERROR_CODES };
