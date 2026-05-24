"use server";

import { isAllowedAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    redirect("/login?error=missing-email");
  }
  if (!isAllowedAdmin(email)) {
    // Same redirect regardless of whether the email exists — don't expose the
    // allowlist via timing or messaging.
    redirect("/login?error=not-allowed");
  }

  const supabase = await createClient();
  const hdr = await headers();
  const origin = hdr.get("origin") ?? `https://${hdr.get("host")}`;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/login?sent=1");
}
