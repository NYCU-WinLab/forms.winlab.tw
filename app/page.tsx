import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-8 p-8">
      <header className="grid gap-2">
        <p className="text-muted-foreground text-sm">forms.winlab.tw</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          幫部門盤點 AI 導入機會
        </h1>
      </header>

      <p className="text-muted-foreground text-base leading-relaxed">
        AI 顧問跟你聊 15-30 分鐘，把部門做什麼、流程怎麼跑、卡在哪、有哪些資料聊清楚。
        WinLab 顧問拿著訪談結果幫你找 AI 介入點。
      </p>

      <div className="text-muted-foreground grid gap-1 text-sm">
        <p>顧問會給你：</p>
        <ul className="list-inside list-disc">
          <li>一條 6 碼通行碼</li>
          <li>一個訪談連結（這個網域底下 /form/XXX）</li>
        </ul>
        <p className="mt-2">空 30 分鐘，回答幾個問題，就這樣。</p>
      </div>

      <div className="flex gap-3">
        <Link href="/login">
          <Button variant="outline">Admin 登入</Button>
        </Link>
      </div>
    </main>
  );
}
