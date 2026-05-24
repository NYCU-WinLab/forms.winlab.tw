import { createClient } from "@/lib/supabase/server";
import { type NextRequest } from "next/server";

export function getAdminAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminAllowlist().includes(email.toLowerCase());
}

export interface AdminContext {
  userId: string;
  email: string;
}

// Server-side guard for actions / route handlers that mutate admin state.
// Returns the verified caller on success; throws otherwise.
export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AdminAuthError("unauthorized");
  if (!isAllowedAdmin(user.email)) throw new AdminAuthError("forbidden");
  return { userId: user.id, email: user.email!.toLowerCase() };
}

export class AdminAuthError extends Error {
  constructor(public code: "unauthorized" | "forbidden") {
    super(code);
    this.name = "AdminAuthError";
  }
}

// Client IP for rate-limit. Trust only platform-signed headers when running
// on Vercel; everywhere else, fall back to x-real-ip set by the immediate
// reverse proxy. Never trust client-supplied x-forwarded-for blindly.
//
// Vercel adds `x-vercel-forwarded-for` (signed, last-hop trustworthy) and
// `x-forwarded-for` (untrusted; client can prepend entries). We prefer the
// former and fall back to the right-most entry of XFF (which our proxy
// itself appended) if signed header is absent.
export function clientIP(request: NextRequest): string {
  const vercelFor = request.headers.get("x-vercel-forwarded-for");
  if (vercelFor) {
    const parts = vercelFor.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }

  const realIP = request.headers.get("x-real-ip")?.trim();
  if (realIP) return realIP;

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }

  return "unknown";
}
