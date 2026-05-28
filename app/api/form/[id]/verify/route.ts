import { clientIP } from "@/lib/auth";
import { ErrorCode, errorJson, logServerError } from "@/lib/errors";
import {
  GATE_COOKIE_TTL_SECONDS,
  cookieName,
  signGateToken,
} from "@/lib/form-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

type AttemptResult =
  | "ok"
  | "rate_limited"
  | "form_locked"
  | "not_found"
  | "wrong_code"
  | "form_completed";

interface AttemptRow {
  result: AttemptResult;
  access_code_version: number | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: formId } = await params;
  const ip = clientIP(request);

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return errorJson(ErrorCode.InvalidBody, 400);
  }
  const code = String(body.code ?? "").trim();
  const badFormat = !/^[0-9]{6}$/.test(code);

  const admin = createAdminClient();
  const rpcResult = await admin.rpc("record_verify_attempt", {
    p_form_id: formId,
    p_ip: ip,
    // Malformed attempts still go through the same atomic rate-limit path.
    // They cannot match a valid 6-digit code, but they must count toward both
    // per-IP and per-form limits.
    p_code: badFormat ? code.slice(0, 64) : code,
  });
  const data = rpcResult.data as AttemptRow[] | null;

  if (rpcResult.error || !data || data.length === 0) {
    logServerError("verify.rpc", rpcResult.error, { formId, ip });
    return errorJson(ErrorCode.DbError, 500);
  }

  const row = data[0]!;
  if (badFormat) {
    switch (row.result) {
      case "rate_limited":
        return errorJson(ErrorCode.TooManyAttempts, 429, { retry_after: 60 });
      case "form_locked":
        return errorJson(ErrorCode.FormLocked, 429, { retry_after: 3600 });
      default:
        return errorJson(ErrorCode.BadCodeFormat, 400);
    }
  }

  switch (row.result) {
    case "rate_limited":
      return errorJson(ErrorCode.TooManyAttempts, 429, { retry_after: 60 });
    case "form_locked":
      return errorJson(ErrorCode.FormLocked, 429, { retry_after: 3600 });
    case "not_found":
      return errorJson(ErrorCode.NotFound, 404);
    case "wrong_code":
      return errorJson(ErrorCode.WrongCode, 401);
    case "form_completed":
      return errorJson(ErrorCode.FormCompleted, 410);
    case "ok":
      break;
    default:
      return errorJson(ErrorCode.DbError, 500);
  }

  const version = row.access_code_version;
  if (version === null) {
    logServerError("verify.missing_version", null, { formId });
    return errorJson(ErrorCode.DbError, 500);
  }

  const token = await signGateToken(formId, version);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName(formId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: GATE_COOKIE_TTL_SECONDS,
    path: "/",
  });
  return response;
}
