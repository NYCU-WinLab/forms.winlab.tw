"use client";

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
import { useRouter } from "next/navigation";
import { useState } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  "wrong-code": "通行碼錯了",
  "bad-code-format": "通行碼是 6 碼數字",
  "too-many-attempts": "嘗試太多次，稍後再試",
  "form-locked": "這份表單嘗試過多已暫時鎖定，請聯絡承辦人",
  "form-completed": "這份表單已結束",
  "not-found": "找不到表單",
  "db-error": "系統錯誤，稍後再試",
  "invalid-body": "請求格式錯誤",
};

export function Gate({
  formId,
  department,
}: {
  formId: string;
  department: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/form/${formId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        // Re-fetch the server component; the now-valid gate cookie will let
        // the chat UI render.
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const code_ = body.error ?? `error-${res.status}`;
      setError(ERROR_MESSAGES[code_] ?? code_);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{department}</CardTitle>
          <CardDescription>輸入通行碼進入訪談</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="code">6 碼通行碼</Label>
              <Input
                id="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
            </div>
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending || code.length !== 6}>
              {pending ? "驗證中…" : "進入"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
