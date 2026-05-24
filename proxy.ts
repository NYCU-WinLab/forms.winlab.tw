import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip API routes (they handle their own auth via cookie/JWT or
    // requireAdmin inside the handler), static assets, image optimizations,
    // and common file extensions. Without `api` here, every /api/form/[id]/*
    // call pays a Supabase auth round-trip before its handler runs.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
