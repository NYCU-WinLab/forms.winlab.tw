import { type FormRow, type MessageRow } from "@/lib/db";
import { cookieName, verifyGateToken } from "@/lib/form-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Chat } from "./chat";
import { Gate } from "./gate";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const admin = createAdminClient();
  const { data } = await admin
    .from("forms")
    .select("department")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.department ? `${data.department} 訪談` : "訪談" };
}

export default async function FormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: formData } = await admin
    .from("forms")
    .select(
      "id, organization, unit, department, department_brief, current_phase, status, access_code_version",
    )
    .eq("id", id)
    .maybeSingle();

  if (!formData) notFound();

  const form = formData as Pick<
    FormRow,
    | "id"
    | "organization"
    | "unit"
    | "department"
    | "department_brief"
    | "current_phase"
    | "status"
    | "access_code_version"
  >;

  // Gate cookie must match the current access_code_version. Code rotation
  // (admin regenerate) invalidates outstanding rep cookies immediately.
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName(id))?.value;
  const passed = token
    ? await verifyGateToken(token, id, form.access_code_version)
    : null;

  if (!passed) {
    return <Gate formId={id} department={form.department} />;
  }

  const { data: msgRows } = await admin
    .from("messages")
    .select("id, role, content, phase, incomplete, created_at")
    .eq("form_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .range(0, 499);

  const messages = (msgRows ?? []) as Pick<
    MessageRow,
    "id" | "role" | "content" | "phase" | "incomplete" | "created_at"
  >[];

  const shouldSeed = messages.length === 0 && form.status === "open";

  return <Chat form={form} initialMessages={messages} shouldSeed={shouldSeed} />;
}
