import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "./actions";

const ERRORS: Record<string, string> = {
  "invalid-credentials": "Email 或密碼錯誤",
  // Surfaced by dashboard layout when a signed-in user fails the allowlist
  // check post-auth — kept distinct because by that point the caller already
  // proved knowledge of the password.
  "not-allowed": "這個 email 不在允許清單",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const error = sp.error ? (ERRORS[sp.error] ?? "登入失敗") : null;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>WinLab Admin</CardTitle>
          <CardDescription>forms.winlab.tw 後台登入</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signIn} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="you@winlab.tw"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">密碼</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit">登入</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
