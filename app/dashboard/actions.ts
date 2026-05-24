"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { customAlphabet, nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const sixDigit = customAlphabet("0123456789", 6);

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createForm(formData: FormData) {
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
  });

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  redirect(`/dashboard/${id}`);
}

export async function regenerateAccessCode(formId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("forms")
    .update({ access_code: sixDigit() })
    .eq("id", formId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${formId}`);
}

export async function closeForm(formId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("forms")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", formId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${formId}`);
}
