"use server";

import { isAllowedAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  // Single generic error for all failure modes — don't leak which emails
  // exist, are in the allowlist, or have wrong passwords.
  if (!email || !password) {
    redirect("/login?error=invalid-credentials");
  }

  // Authenticate FIRST, then enforce the allowlist, so response timing doesn't
  // reveal whether an email is on the allowlist. The previous pre-auth check
  // returned instantly for non-allowlisted emails — a membership oracle.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect("/login?error=invalid-credentials");
  }

  if (!isAllowedAdmin(email)) {
    await supabase.auth.signOut();
    redirect("/login?error=invalid-credentials");
  }

  redirect("/dashboard");
}
