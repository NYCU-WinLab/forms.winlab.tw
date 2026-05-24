"use server";

import { AdminAuthError, requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { customAlphabet, nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const sixDigit = customAlphabet("0123456789", 6);

async function audit(
  actor: { userId: string; email: string },
  action: string,
  formId: string | null,
  details: Record<string, unknown> | null = null,
) {
  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    actor_id: actor.userId,
    actor_email: actor.email,
    action,
    form_id: formId,
    details,
  });
}

function adminAuthFailed(err: unknown): never {
  if (err instanceof AdminAuthError) {
    redirect(err.code === "forbidden" ? "/login?error=not-allowed" : "/login");
  }
  throw err;
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createForm(formData: FormData) {
  let actor;
  try {
    actor = await requireAdmin();
  } catch (err) {
    adminAuthFailed(err);
  }

  const organization = String(formData.get("organization") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const department = String(formData.get("department") ?? "").trim();
  const departmentBrief =
    String(formData.get("department_brief") ?? "").trim() || null;

  if (!organization || !department) {
    throw new Error("organization 跟 department 必填");
  }

  const id = nanoid(8);
  const access_code = sixDigit();

  const admin = createAdminClient();
  const { error } = await admin.from("forms").insert({
    id,
    organization,
    unit,
    department,
    department_brief: departmentBrief,
    access_code,
    owner_id: actor.userId,
  });

  if (error) throw new Error(error.message);

  await audit(actor, "form.create", id, { organization, department });
  revalidatePath("/dashboard");
  redirect(`/dashboard/${id}`);
}

export async function regenerateAccessCode(formId: string) {
  let actor;
  try {
    actor = await requireAdmin();
  } catch (err) {
    adminAuthFailed(err);
  }

  const admin = createAdminClient();

  // Owner check — admins only see / mutate forms they created.
  const { data: form, error: lookupErr } = await admin
    .from("forms")
    .select("id, owner_id")
    .eq("id", formId)
    .maybeSingle();
  if (lookupErr) throw new Error(lookupErr.message);
  if (!form) throw new Error("not-found");
  if (form.owner_id && form.owner_id !== actor.userId) {
    throw new Error("forbidden");
  }

  const newCode = sixDigit();
  const { data, error } = await admin.rpc("regenerate_access_code", {
    p_form_id: formId,
    p_new_code: newCode,
  });
  if (error) throw new Error(error.message);

  await audit(actor, "form.regenerate_code", formId, {
    new_version: Array.isArray(data) ? data[0]?.new_version : null,
  });
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${formId}`);
}

export async function closeForm(formId: string) {
  let actor;
  try {
    actor = await requireAdmin();
  } catch (err) {
    adminAuthFailed(err);
  }

  const admin = createAdminClient();

  const { data: form, error: lookupErr } = await admin
    .from("forms")
    .select("id, owner_id")
    .eq("id", formId)
    .maybeSingle();
  if (lookupErr) throw new Error(lookupErr.message);
  if (!form) throw new Error("not-found");
  if (form.owner_id && form.owner_id !== actor.userId) {
    throw new Error("forbidden");
  }

  const { error } = await admin
    .from("forms")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", formId);
  if (error) throw new Error(error.message);

  await audit(actor, "form.close", formId);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${formId}`);
}
