import type { ValidationIssue } from "./validation";

export type XenonErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE";

const STATUS: Record<XenonErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
};

/** Operational error raised by the Local API; the REST layer maps it to an HTTP response. */
export class XenonError extends Error {
  override name = "XenonError";
  readonly status: number;
  constructor(
    readonly code: XenonErrorCode,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export function isXenonError(e: unknown): e is XenonError {
  return e instanceof Error && e.name === "XenonError" && "code" in e && "status" in e;
}
