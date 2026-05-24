import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PHASES,
  PHASE_LABEL_SHORT,
  type FormRow,
  type MessageRow,
} from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { notFound } from "next/navigation";
import { closeForm, regenerateAccessCode } from "../actions";
import { CopyLinkButton } from "./copy-link-button";

interface ToolCall {
  id?: string;
  type: "function";
  function: { name: string; arguments: string };
}

export const dynamic = "force-dynamic";

export default async function FormDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();

  const { data: formData } = await admin
    .from("forms")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!formData) notFound();
  const form = formData as FormRow;

  // Owner gate. Treat foreign forms as not-found (don't leak existence /
  // access_code via different error messages).
  if (form.owner_id && form.owner_id !== user!.id) notFound();

  const { data: msgRows } = await admin
    .from("messages")
    .select("*")
    .eq("form_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .range(0, 499);
  const messages = (msgRows ?? []) as MessageRow[];

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{form.department}</h1>
          <Badge variant={form.status === "open" ? "default" : "secondary"}>
            {form.status}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {form.organization}
          {form.unit ? ` / ${form.unit}` : ""}
        </p>
        {form.department_brief && (
          <p className="text-muted-foreground text-sm">
            背景：{form.department_brief}
          </p>
        )}
      </div>

      <div className="grid gap-3 rounded-lg border p-4">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <span className="text-muted-foreground text-xs">通行碼</span>
          <code className="font-mono text-lg tracking-[0.3em]">
            {form.access_code}
          </code>
          <form action={regenerateAccessCode.bind(null, form.id)}>
            <Button type="submit" variant="outline" size="sm">
              重新產生
            </Button>
          </form>
        </div>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <span className="text-muted-foreground text-xs">表單連結</span>
          <code className="text-muted-foreground truncate text-xs">
            /form/{form.id}
          </code>
          <CopyLinkButton formId={form.id} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PHASES.map((p) => (
            <Badge
              key={p}
              variant={p === form.current_phase ? "default" : "outline"}
              className={cn(
                "text-[10px]",
                p === form.current_phase ? "" : "text-muted-foreground",
              )}
            >
              {PHASE_LABEL_SHORT[p]}
            </Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Transcript</h2>
          {form.status === "open" && messages.length > 0 && (
            <form action={closeForm.bind(null, form.id)}>
              <Button type="submit" variant="ghost" size="sm">
                手動結束
              </Button>
            </form>
          )}
        </div>

        {messages.length === 0 ? (
          <p className="text-muted-foreground text-sm">尚未開始對話。</p>
        ) : (
          <ol className="grid gap-3">
            {messages.map((m) => (
              <TranscriptItem key={m.id} message={m} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function TranscriptItem({ message }: { message: MessageRow }) {
  const isUser = message.role === "user";
  const toolCalls = (message.tool_calls as ToolCall[] | null) ?? [];
  return (
    <li className="grid gap-1">
      <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
        <span className="font-semibold uppercase">{message.role}</span>
        {message.phase && (
          <Badge variant="outline" className="text-[10px]">
            {PHASE_LABEL_SHORT[message.phase]}
          </Badge>
        )}
        {message.incomplete && (
          <Badge variant="outline" className="text-[10px]">
            incomplete
          </Badge>
        )}
        <span>
          {new Date(message.created_at).toLocaleString("zh-TW", {
            dateStyle: "short",
            timeStyle: "medium",
          })}
        </span>
      </div>
      <div
        className={cn(
          "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
          isUser ? "bg-primary/5 border-primary/20 border" : "bg-muted",
        )}
      >
        {message.content || (
          <span className="text-muted-foreground italic">(empty)</span>
        )}
      </div>
      {toolCalls.length > 0 && (
        <div className="text-muted-foreground grid gap-1 px-3 text-[11px]">
          {toolCalls.map((tc, i) => {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch (e) {
              console.error("[transcript] bad tool_call arguments", {
                messageId: message.id,
                tool: tc.function.name,
                err: e,
              });
            }
            return (
              <div key={i}>
                <span className="font-mono">→ {tc.function.name}</span>
                <span> {JSON.stringify(args)}</span>
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}
