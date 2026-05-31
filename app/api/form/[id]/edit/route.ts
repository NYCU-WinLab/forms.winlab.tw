import { ErrorCode, errorJson, logServerError } from "@/lib/errors";
import { cookieName, verifyGateToken } from "@/lib/form-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { type Phase } from "@/lib/db";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

interface RewindRow {
  result:
    | "ok"
    | "invalid_target"
    | "already_deleted"
    | "form_completed"
    | "not_found";
  new_phase: Phase | null;
}

const MAX_CONTENT = 4000;
// Per-form write-rate limit. Edits insert rows and contend the per-form
// advisory lock with chat; without this a gate-cookie holder could script
// write-amplifying edits. Mirrors the chat endpoint's window.
const EDIT_WINDOW_SECONDS = 60;
const EDIT_MAX_PER_WINDOW = 8;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: formId } = await params;
  const token = request.cookies.get(cookieName(formId))?.value;

  let body: { messageId?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return errorJson(ErrorCode.InvalidBody, 400);
  }
  const messageId = String(body.messageId ?? "");
  const content = String(body.content ?? "").trim();
  if (!messageId || !content) {
    return errorJson(ErrorCode.MissingFields, 400);
  }
  if (content.length > MAX_CONTENT) {
    return errorJson(ErrorCode.ContentTooLong, 413, { max: MAX_CONTENT });
  }

  const admin = createAdminClient();

  const { data: formRow, error: formErr } = await admin
    .from("forms")
    .select("id, status, access_code_version")
    .eq("id", formId)
    .maybeSingle();
  if (formErr) {
    logServerError("edit.form_lookup", formErr, { formId });
    return errorJson(ErrorCode.DbError, 500);
  }
  if (!formRow) {
    return errorJson(ErrorCode.NotFound, 404);
  }

  if (!token || !(await verifyGateToken(token, formId, formRow.access_code_version))) {
    return errorJson(ErrorCode.Unauthorized, 401);
  }

  // C2: a rep can rewind their own message, but cannot resurrect a form that
  // an admin has explicitly closed. This is a fast path only — the RPC
  // re-checks status under its advisory lock to close the TOCTOU window where
  // an admin closes the form between this read and the mutation.
  if (formRow.status === "completed") {
    return errorJson(ErrorCode.FormCompleted, 410);
  }

  // Per-form write-rate limit: count messages written in the window (including
  // soft-deleted rows, since each edit inserts + tombstones). Bounds edit-spam.
  const windowStart = new Date(
    Date.now() - EDIT_WINDOW_SECONDS * 1000,
  ).toISOString();
  const { count: recent, error: rateErr } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId)
    .gte("created_at", windowStart);
  if (rateErr) {
    logServerError("edit.rate_check", rateErr, { formId });
    return errorJson(ErrorCode.DbError, 500);
  }
  if ((recent ?? 0) >= EDIT_MAX_PER_WINDOW) {
    return errorJson(ErrorCode.ChatRateLimited, 429, {
      retry_after: EDIT_WINDOW_SECONDS,
    });
  }

  const rpcResult = await admin.rpc("edit_message_and_rewind", {
    p_form_id: formId,
    p_message_id: messageId,
    p_new_content: content,
  });
  const data = rpcResult.data as RewindRow[] | null;

  if (rpcResult.error || !data || data.length === 0) {
    logServerError("edit.rpc", rpcResult.error, { formId, messageId });
    return errorJson(ErrorCode.DbError, 500);
  }

  const row = data[0]!;
  switch (row.result) {
    case "invalid_target":
      return errorJson(ErrorCode.InvalidTarget, 400);
    case "already_deleted":
      return errorJson(ErrorCode.AlreadyDeleted, 410);
    case "form_completed":
      // Admin closed the form between our status read and the locked RPC.
      return errorJson(ErrorCode.FormCompleted, 410);
    case "not_found":
      return errorJson(ErrorCode.NotFound, 404);
    case "ok": {
      // Audit the rep-side mutation. Anonymous actor; form_id ties it to the
      // department. Don't fail the edit if the audit write itself errors.
      const { error: auditErr } = await admin.from("audit_log").insert({
        actor_id: null,
        actor_email: null,
        action: "rep.edit_rewind",
        form_id: formId,
        details: { message_id: messageId, new_phase: row.new_phase },
      });
      if (auditErr)
        logServerError("edit.audit", auditErr, { formId, messageId });
      return Response.json({ ok: true, phase: row.new_phase });
    }
    default:
      return errorJson(ErrorCode.DbError, 500);
  }
}
