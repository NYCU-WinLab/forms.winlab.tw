import { type Phase } from "@/lib/db";
import { cookieName, verifyGateToken } from "@/lib/form-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: formId } = await params;

  const token = request.cookies.get(cookieName(formId))?.value;
  if (!token || !(await verifyGateToken(token, formId))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { messageId?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }
  const messageId = String(body.messageId ?? "");
  const content = String(body.content ?? "").trim();
  if (!messageId || !content) {
    return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: target, error: targetErr } = await admin
    .from("messages")
    .select("id, role, form_id, phase, created_at, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (targetErr) {
    return NextResponse.json({ error: targetErr.message }, { status: 500 });
  }
  if (!target || target.form_id !== formId || target.role !== "user") {
    return NextResponse.json({ error: "invalid-target" }, { status: 400 });
  }
  if (target.deleted_at) {
    return NextResponse.json({ error: "already-deleted" }, { status: 410 });
  }

  const now = new Date().toISOString();

  // Soft-delete edited message + everything after.
  const { error: delErr } = await admin
    .from("messages")
    .update({ deleted_at: now })
    .eq("form_id", formId)
    .gte("created_at", target.created_at)
    .is("deleted_at", null);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Insert new user message (replaces the edited one).
  const phaseForNew: Phase = (target.phase as Phase | null) ?? "context";
  const { error: insertErr } = await admin.from("messages").insert({
    form_id: formId,
    role: "user",
    content,
    phase: phaseForNew,
  });
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Rewind form: phase back to the edited message's phase, reopen if it was completed.
  await admin
    .from("forms")
    .update({
      current_phase: phaseForNew,
      status: "open",
      completed_at: null,
    })
    .eq("id", formId);

  return NextResponse.json({ ok: true, phase: phaseForNew });
}
