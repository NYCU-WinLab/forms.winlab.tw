import { ErrorCode, errorJson, logServerError } from "@/lib/errors";
import { cookieName, verifyGateToken } from "@/lib/form-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { type Phase } from "@/lib/db";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

interface RewindRow {
  result: "ok" | "invalid_target" | "already_deleted";
  new_phase: Phase | null;
}

const MAX_CONTENT = 4000;

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
  // an admin has explicitly closed.
  if (formRow.status === "completed") {
    return errorJson(ErrorCode.FormCompleted, 410);
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
    case "ok":
      return Response.json({ ok: true, phase: row.new_phase });
    default:
      return errorJson(ErrorCode.DbError, 500);
  }
}
