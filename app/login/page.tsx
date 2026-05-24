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
import { requestMagicLink } from "./actions";

const ERRORS: Record<string, string> = {
  "missing-email": "請輸入 email",
  "not-allowed": "這個 email 不在允許清單",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const sent = sp.sent === "1";
  const error = sp.error ? (ERRORS[sp.error] ?? sp.error) : null;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>WinLab Admin</CardTitle>
          <CardDescription>forms.winlab.tw 後台登入</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm">
              連結已寄出。檢查信箱 → 點 link → 回到後台。
            </p>
          ) : (
            <form action={requestMagicLink} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@winlab.tw"
                />
              </div>
              {error && (
                <p className="text-destructive text-sm">{error}</p>
              )}
              <Button type="submit">寄出 magic link</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
