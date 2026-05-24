// Stable, client-facing error codes. Never expose raw DB error messages to
// the browser — log full detail server-side, send a code from this list.

export const ErrorCode = {
  Unauthorized:      "unauthorized",
  Forbidden:         "forbidden",
  BadRequest:        "bad-request",
  InvalidBody:       "invalid-body",
  MissingFields:     "missing-fields",
  NotFound:          "not-found",
  AlreadyDeleted:    "already-deleted",
  InvalidTarget:     "invalid-target",
  FormCompleted:     "form-completed",
  PhaseChanged:      "phase-changed",
  WrongCode:         "wrong-code",
  BadCodeFormat:     "bad-code-format",
  TooManyAttempts:   "too-many-attempts",
  FormLocked:        "form-locked",
  ContentTooLong:    "content-too-long",
  ChatRateLimited:   "chat-rate-limited",
  UpstreamError:     "upstream-error",
  DbError:           "db-error",
  StreamError:       "stream-error",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export function errorJson(
  code: ErrorCodeValue,
  status: number,
  extra: Record<string, unknown> = {},
) {
  return Response.json({ error: code, ...extra }, { status });
}

export function logServerError(scope: string, err: unknown, ctx: Record<string, unknown> = {}) {
  // Server-side full detail; never bubbled to client.
  console.error(`[${scope}]`, ctx, err);
}
