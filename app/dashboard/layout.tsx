import { Button } from "@/components/ui/button";
import { isAllowedAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "./actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAllowedAdmin(user.email)) {
    await supabase.auth.signOut();
    redirect("/login?error=not-allowed");
  }

  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
          <Link href="/dashboard" className="font-semibold">
            forms.winlab.tw
          </Link>
          <form action={signOut}>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-sm">
                {user.email}
              </span>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </div>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
