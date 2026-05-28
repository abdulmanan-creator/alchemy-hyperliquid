import type { FastifyReply } from "fastify";
import {
  type ApiError,
  type ErrorCode,
  HTTP_STATUS_FOR_CODE,
} from "@alchemy-hl/shared";

export class ApiException extends Error {
  readonly code: ErrorCode;
  readonly guidance: string;
  constructor(code: ErrorCode, message: string, guidance: string) {
    super(message);
    this.code = code;
    this.guidance = guidance;
  }
  toJSON(): ApiError {
    return { error: this.code, message: this.message, guidance: this.guidance };
  }
}

export function sendError(reply: FastifyReply, err: ApiException): FastifyReply {
  return reply.code(HTTP_STATUS_FOR_CODE[err.code]).send(err.toJSON());
}
