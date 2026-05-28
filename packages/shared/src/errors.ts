/**
 * Error contract for every non-2xx response from the API.
 *
 *   { error: ErrorCode, message: string, guidance: string }
 *
 * Frontends should surface `guidance` to the user — it's the "what do I do
 * about this?" text written for humans.
 */

export const ERROR_CODES = [
  "INVALID_JSON",
  "INVALID_PARAMS",
  "NOT_APPROVED",
  "BUILDER_MISMATCH",
  "SIGNATURE_INVALID",
  "HL_EXCHANGE_REJECTED",
  "HL_EXCHANGE_UNREACHABLE",
  "NEEDS_DEPOSIT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: ErrorCode;
  message: string;
  guidance: string;
}

export const HTTP_STATUS_FOR_CODE: Record<ErrorCode, number> = {
  INVALID_JSON: 400,
  INVALID_PARAMS: 422,
  NOT_APPROVED: 403,
  BUILDER_MISMATCH: 422,
  SIGNATURE_INVALID: 422,
  HL_EXCHANGE_REJECTED: 422,
  HL_EXCHANGE_UNREACHABLE: 502,
  NEEDS_DEPOSIT: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};
