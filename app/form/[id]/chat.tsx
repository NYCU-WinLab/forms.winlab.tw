"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PHASES, type FormRow, type MessageRow, type Phase } from "@/lib/db";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type UIMessage = Pick<MessageRow, "id" | "role" | "content" | "phase"> & {
  streaming?: boolean;
};

const PHASE_LABEL: Record<Phase, string> = {
  context: "Context",
  workflow: "Workflow",
  pain: "Pain",
  data: "Data",
  wrapup: "Wrap-up",
};

type FormHead = Pick<
  FormRow,
  | "id"
  | "organization"
  | "unit"
  | "department"
  | "department_brief"
  | "current_phase"
  | "status"
>;

export function Chat({
  form,
  initialMessages,
}: {
  form: FormHead;
  initialMessages: Pick<MessageRow, "id" | "role" | "content" | "phase" | "created_at">[];
}) {
  const [messages, setMessages] = useState<UIMessage[]>(
    initialMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        phase: m.phase,
      })),
  );
  const [phase, setPhase] = useState<Phase>(form.current_phase);
  const [status, setStatus] = useState<"open" | "completed">(form.status);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const compositionEndedAt = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initFired = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (initFired.current) return;
    if (messages.length === 0 && status === "open") {
      initFired.current = true;
      void runChat(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runChat(userContent: string | null) {
    setStreaming(true);
    setError(null);

    if (userContent) {
      setMessages((m) => [
        ...m,
        {
          id: `local-${Date.now()}`,
          role: "user",
          content: userContent,
          phase,
        },
      ]);
    }

    const placeholderId = `streaming-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: placeholderId, role: "assistant", content: "", phase, streaming: true },
    ]);

    try {
      const res = await fetch(`/api/form/${form.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userContent ? { content: userContent } : {}),
      });

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `http-${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          let event: {
            type: string;
            delta?: string;
            to?: Phase;
            message?: string;
          };
          try {
            event = JSON.parse(json);
          } catch {
            continue;
          }

          if (event.type === "text" && event.delta) {
            setMessages((m) =>
              m.map((x) =>
                x.id === placeholderId
                  ? { ...x, content: x.content + event.delta }
                  : x,
              ),
            );
          } else if (event.type === "phase" && event.to) {
            setPhase(event.to);
          } else if (event.type === "completed") {
            setStatus("completed");
          } else if (event.type === "error") {
            setError(event.message ?? "stream error");
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMessages((m) =>
        m.map((x) => (x.id === placeholderId ? { ...x, streaming: false } : x)),
      );
      setStreaming(false);
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || streaming || status === "completed" || editingId) return;
    setInput("");
    await runChat(content);
  }

  function startEdit(m: UIMessage) {
    if (streaming) return;
    setEditingId(m.id);
    setEditDraft(m.content);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  async function saveEdit() {
    if (!editingId) return;
    const draft = editDraft.trim();
    if (!draft) return;

    setError(null);

    let phaseFromServer: Phase | null = null;
    try {
      const res = await fetch(`/api/form/${form.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: editingId, content: draft }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `http-${res.status}`);
      }
      const data = (await res.json()) as { phase: Phase };
      phaseFromServer = data.phase;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    const idx = messages.findIndex((m) => m.id === editingId);
    if (idx === -1) {
      setError("找不到要編輯的訊息");
      return;
    }

    setMessages((prev) => [
      ...prev.slice(0, idx),
      {
        id: `local-edit-${Date.now()}`,
        role: "user",
        content: draft,
        phase: phaseFromServer,
      },
    ]);
    setPhase(phaseFromServer ?? phase);
    setStatus("open");
    setEditingId(null);
    setEditDraft("");

    await runChat(null);
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-muted-foreground text-xs">
                {form.organization}
                {form.unit ? ` / ${form.unit}` : ""}
              </p>
              <h1 className="font-semibold">{form.department}</h1>
            </div>
            {status === "completed" && <Badge variant="secondary">已結束</Badge>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PHASES.map((p) => (
              <Badge
                key={p}
                variant={p === phase ? "default" : "outline"}
                className={cn(
                  "text-[10px]",
                  p === phase ? "" : "text-muted-foreground",
                )}
              >
                {PHASE_LABEL[p]}
              </Badge>
            ))}
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
          {messages.map((m) =>
            editingId === m.id ? (
              <EditingBubble
                key={m.id}
                draft={editDraft}
                onChange={setEditDraft}
                onSave={saveEdit}
                onCancel={cancelEdit}
              />
            ) : (
              <MessageBubble
                key={m.id}
                message={m}
                canEdit={
                  m.role === "user" &&
                  !m.streaming &&
                  !streaming &&
                  !m.id.startsWith("local-") &&
                  !m.id.startsWith("streaming-")
                }
                onEdit={() => startEdit(m)}
              />
            ),
          )}
          {error && (
            <div className="text-destructive border-destructive/30 bg-destructive/10 rounded-lg border p-3 text-sm">
              出錯了：{error}
            </div>
          )}
        </div>
      </div>

      <footer className="bg-background border-t">
        <div className="mx-auto max-w-3xl p-4">
          {status === "completed" ? (
            <p className="text-muted-foreground text-center text-sm">
              訪談已結束，感謝你撥空。
            </p>
          ) : (
            <form onSubmit={onSend} className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => {
                  setIsComposing(false);
                  compositionEndedAt.current = Date.now();
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  if (isComposing) return;
                  if (e.nativeEvent.isComposing) return;
                  if (e.keyCode === 229) return;
                  if (Date.now() - compositionEndedAt.current < 50) return;
                  e.preventDefault();
                  void onSend(e as unknown as React.FormEvent);
                }}
                rows={2}
                placeholder="輸入回覆… (Enter 送出，Shift+Enter 換行)"
                disabled={streaming || !!editingId}
                className="resize-none"
              />
              <Button
                type="submit"
                disabled={streaming || !!editingId || !input.trim()}
              >
                送出
              </Button>
            </form>
          )}
        </div>
      </footer>
    </div>
  );
}

function MessageBubble({
  message,
  canEdit,
  onEdit,
}: {
  message: UIMessage;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "group flex items-end gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {isUser && canEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="text-muted-foreground hover:text-foreground self-center opacity-0 transition group-hover:opacity-100"
          aria-label="編輯"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {message.content || (message.streaming ? "…" : "")}
      </div>
    </div>
  );
}

function EditingBubble({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-end">
      <div className="bg-muted/60 ring-primary/30 grid w-full max-w-[85%] gap-2 rounded-2xl p-3 ring-1">
        <Textarea
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={onSave} disabled={!draft.trim()}>
            存檔並重新生成
          </Button>
        </div>
      </div>
    </div>
  );
}
