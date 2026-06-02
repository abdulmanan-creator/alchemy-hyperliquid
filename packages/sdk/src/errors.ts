import type { ApiError, ErrorCode } from "@alchemy-hl/shared";

export type { ApiError, ErrorCode };

/**
 * Thrown by any SDK call that the backend rejects with a structured
 * {@link ApiError} response. Preserves the backend's code + message + guidance
 * so callers can switch on `err.code` or surface `err.guidance` to humans.
 */
export class AlchemyHlError extends Error {
  readonly code: ErrorCode;
  readonly guidance: string;
  readonly httpStatus: number;
  readonly response?: unknown;

  constructor(opts: {
    code: ErrorCode;
    message: string;
    guidance: string;
    httpStatus: number;
    response?: unknown;
  }) {
    super(opts.message);
    this.name = "AlchemyHlError";
    this.code = opts.code;
    this.guidance = opts.guidance;
    this.httpStatus = opts.httpStatus;
    this.response = opts.response;
  }
}

/**
 * Thrown when the SDK can't build a request (missing required fields, etc.)
 * Distinct from backend errors so callers can tell client-side bugs from
 * server-side rejections.
 */
export class SdkInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SdkInputError";
  }
}
