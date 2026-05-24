import { type FormRow, type MessageRow } from "@/lib/db";
import { cookieName, verifyGateToken } from "@/lib/form-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Chat } from "./chat";
import { Gate } from "./gate";

export const dynamic = "force-dynamic";

export default async function FormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: formData } = await admin
    .from("forms")
    .select("id, organization, unit, department, department_brief, current_phase, status")
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
  >;

  // Check gate cookie
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName(id))?.value;
  const passed = token ? await verifyGateToken(token, id) : false;

  if (!passed) {
    return <Gate formId={id} department={form.department} />;
  }

  // Load messages
  const { data: msgRows } = await admin
    .from("messages")
    .select("id, role, content, phase, created_at")
    .eq("form_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const messages = (msgRows ?? []) as Pick<
    MessageRow,
    "id" | "role" | "content" | "phase" | "created_at"
  >[];

  return <Chat form={form} initialMessages={messages} />;
}
