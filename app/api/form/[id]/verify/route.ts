import { GATE_COOKIE_TTL_SECONDS, cookieName, signGateToken } from "@/lib/form-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS_PER_WINDOW = 5;

function clientIP(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: formId } = await params;
  const ip = clientIP(request);
  const admin = createAdminClient();

  // Rate-limit: count attempts from this IP in the window.
  const windowStart = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();
  const { count: recentAttempts, error: countErr } = await admin
    .from("verify_attempts")
    .select("*", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", windowStart);

  if (countErr) {
    return NextResponse.json({ error: "rate-limit-check-failed" }, { status: 500 });
  }

  if ((recentAttempts ?? 0) >= MAX_ATTEMPTS_PER_WINDOW) {
    return NextResponse.json(
      { error: "too-many-attempts", retry_after: WINDOW_SECONDS },
      { status: 429 },
    );
  }

  // Parse body
  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();
  if (!/^[0-9]{6}$/.test(code)) {
    await admin
      .from("verify_attempts")
      .insert({ form_id: formId, ip, succeeded: false });
    return NextResponse.json({ error: "bad-code-format" }, { status: 400 });
  }

  // Look up form + compare code.
  const { data: form, error: formErr } = await admin
    .from("forms")
    .select("id, access_code, status")
    .eq("id", formId)
    .maybeSingle();

  if (formErr) {
    return NextResponse.json({ error: "lookup-failed" }, { status: 500 });
  }
  if (!form) {
    await admin
      .from("verify_attempts")
      .insert({ form_id: formId, ip, succeeded: false });
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const ok = form.access_code === code;
  await admin
    .from("verify_attempts")
    .insert({ form_id: formId, ip, succeeded: ok });

  if (!ok) {
    return NextResponse.json({ error: "wrong-code" }, { status: 401 });
  }

  if (form.status === "completed") {
    return NextResponse.json({ error: "form-completed" }, { status: 410 });
  }

  const token = await signGateToken(formId);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName(formId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: GATE_COOKIE_TTL_SECONDS,
    path: "/",
  });
  return response;
}
