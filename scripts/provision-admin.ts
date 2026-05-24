#!/usr/bin/env bun
// Provision (or reset password for) a Supabase admin user.
//
// Usage:
//   ADMIN_PASSWORD='...' bun scripts/provision-admin.ts            # uses first ADMIN_EMAILS entry
//   ADMIN_PASSWORD='...' bun scripts/provision-admin.ts other@x.io # explicit email (still must be in allowlist)
//
// Reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / ADMIN_EMAILS from
// .env.local (bun loads it automatically). Service-role key is server-only —
// never run this from anywhere the secret leaks.

import { createClient } from "@supabase/supabase-js";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const url = need("NEXT_PUBLIC_SUPABASE_URL");
const secret = need("SUPABASE_SECRET_KEY");
const password = need("ADMIN_PASSWORD");

const allowlist = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const targetEmail = (process.argv[2] ?? allowlist[0] ?? "").trim().toLowerCase();

if (!targetEmail) {
  console.error("No target email — pass as argv[2] or set ADMIN_EMAILS.");
  process.exit(1);
}

if (!allowlist.includes(targetEmail)) {
  console.error(
    `${targetEmail} is not in ADMIN_EMAILS — refusing to provision a user the app won't trust.`,
  );
  process.exit(1);
}

if (password.length < 16) {
  console.error("ADMIN_PASSWORD too short — require ≥16 chars.");
  process.exit(1);
}

const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// listUsers — fine for a small admin pool. Bump pagination if the project
// ever grows past 1000 users for unrelated reasons.
const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
  perPage: 1000,
});
if (listErr) {
  console.error("listUsers failed:", listErr.message);
  process.exit(1);
}

const existing = list.users.find(
  (u) => u.email?.toLowerCase() === targetEmail,
);

if (existing) {
  const { error } = await supabase.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
  });
  if (error) {
    console.error("updateUserById failed:", error.message);
    process.exit(1);
  }
  console.log(`✓ Reset password for existing admin: ${targetEmail}`);
} else {
  const { error } = await supabase.auth.admin.createUser({
    email: targetEmail,
    password,
    email_confirm: true,
  });
  if (error) {
    console.error("createUser failed:", error.message);
    process.exit(1);
  }
  console.log(`✓ Created admin user: ${targetEmail}`);
}
