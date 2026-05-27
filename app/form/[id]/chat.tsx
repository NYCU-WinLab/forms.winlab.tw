"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type FormRow, type MessageRow, type Phase } from "@/lib/db";
import { cn } from "@/lib/utils";
import { ArrowUp, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type UIMessage = Pick<MessageRow, "id" | "role" | "content" | "phase"> & {
  streaming?: boolean;
  incomplete?: boolean;
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

type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "phase"; to: Phase }
  | { type: "completed" }
  | { type: "done" }
  | { type: "error"; code?: string; message?: string };

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "登入逾時，請重新輸入通行碼",
  "form-completed": "這份表單已結束",
  "content-too-long": "訊息太長，請縮短",
  "chat-rate-limited": "送得太快了，稍後再試",
  "phase-changed": "對話階段已被其他視窗變更，重新載入中…",
  "upstream-error": "AI 暫時忙線，稍後再試",
  "db-error": "系統錯誤，稍後再試",
  "stream-error": "連線中斷，稍後再試",
};

export function Chat({
  form,
  initialMessages,
  shouldSeed,
}: {
  form: FormHead;
  initialMessages: Pick<
    MessageRow,
    "id" | "role" | "content" | "phase" | "incomplete" | "created_at"
  >[];
  shouldSeed: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UIMessage[]>(
    initialMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        phase: m.phase,
        incomplete: m.incomplete,
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
  const abortRef = useRef<AbortController | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (didInit.current) return;
    if (shouldSeed) {
      didInit.current = true;
      void runChat(null);
    }
    return () => {
      // Component unmount → cancel any in-flight stream.
      abortRef.current?.abort();
    };
    // shouldSeed is a one-shot trigger from the server snapshot; the ref
    // guards against StrictMode double-fire, so the effect intentionally
    // depends only on shouldSeed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSeed]);

  function showError(code: string | undefined, fallback: string) {
    if (code === "phase-changed") {
      // State drift — pull a fresh server snapshot.
      router.refresh();
      return;
    }
    setError((code && ERROR_MESSAGES[code]) ?? fallback);
  }

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
      {
        id: placeholderId,
        role: "assistant",
        content: "",
        phase,
        streaming: true,
      },
    ]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`/api/form/${form.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userContent ? { content: userContent } : {}),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        showError(body.error, `http-${res.status}`);
        return;
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
          let event: StreamEvent;
          try {
            event = JSON.parse(json) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "text") {
            setMessages((m) =>
              m.map((x) =>
                x.id === placeholderId
                  ? { ...x, content: x.content + event.delta }
                  : x,
              ),
            );
          } else if (event.type === "phase") {
            setPhase(event.to);
          } else if (event.type === "completed") {
            setStatus("completed");
          } else if (event.type === "error") {
            showError(event.code, event.message ?? "stream-error");
          }
        }
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
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
        showError(body.error, `http-${res.status}`);
        return;
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
    <div className="relative h-svh">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-busy={streaming}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-20 pb-36">
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
            <div
              role="alert"
              className="text-destructive border-destructive/30 bg-destructive/10 rounded-lg border p-3 text-sm"
            >
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-20">
        <ProgressiveBlur side="top" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 pt-20">
        <ProgressiveBlur side="bottom" />
        <div className="pointer-events-auto relative mx-auto max-w-3xl px-4 pb-4">
          {status === "completed" ? (
            <p className="text-muted-foreground text-center text-sm">
              訪談已結束，感謝你撥空。
            </p>
          ) : (
            <form
              onSubmit={onSend}
              className="border-input bg-background focus-within:border-ring focus-within:ring-ring/50 flex items-end gap-2 rounded-2xl border px-3 py-2 shadow-sm transition-colors focus-within:ring-3"
            >
              <div className="relative flex-1">
                {!input && (
                  <div className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center text-base md:text-sm">
                    輸入回覆
                    <AnimatedDots />
                  </div>
                )}
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
                  rows={1}
                  disabled={streaming || !!editingId}
                  className="block max-h-40 min-h-0 w-full resize-none border-0 bg-transparent px-0 py-1.5 shadow-none focus-visible:border-0 focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent"
                  aria-label="回覆內容"
                />
              </div>
              <Button
                type="submit"
                size="icon"
                disabled={streaming || !!editingId || !input.trim()}
                aria-label="送出"
                className="size-8 shrink-0 rounded-full"
              >
                <ArrowUp className="size-4" />
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Progressive blur: stacked backdrop-filter layers, each masked with a
// linear-gradient. Strongest blur sits at the bottom and fades out fastest
// going up, so cumulatively the effect sharpens toward the top while a
// background gradient keeps the input area legible.
function ProgressiveBlur({ side }: { side: "top" | "bottom" }) {
  const layers = [
    { blur: 4, to: "30%" },
    { blur: 2, to: "55%" },
    { blur: 1, to: "80%" },
    { blur: 0.5, to: "100%" },
  ];
  const dir = side === "bottom" ? "to top" : "to bottom";
  const bg = side === "bottom" ? "bg-gradient-to-t" : "bg-gradient-to-b";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {layers.map((l) => {
        const mask = `linear-gradient(${dir}, rgba(0,0,0,1) 0%, rgba(0,0,0,0) ${l.to})`;
        return (
          <div
            key={l.blur}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${l.blur}px)`,
              WebkitBackdropFilter: `blur(${l.blur}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}
      <div
        className={cn(
          "from-background via-background/80 absolute inset-0 to-transparent",
          bg,
        )}
      />
    </div>
  );
}

// Cycles 1→2→3 trailing dots. Fixed width so neighbouring text doesn't shift.
function AnimatedDots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x % 3) + 1), 450);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="inline-block w-[1.25em] text-left">{".".repeat(n)}</span>
  );
}

const THINKING_VERBS = [
  "思考中",
  "釐清中",
  "拆解問題",
  "爬梳脈絡",
  "歸納重點",
  "琢磨中",
];

// Cycles a verb while the assistant turn is still empty, so the wait reads as
// active rather than a frozen ellipsis.
function ThinkingIndicator() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setI((n) => (n + 1) % THINKING_VERBS.length),
      1800,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-muted-foreground inline-flex items-center">
      {THINKING_VERBS[i]}
      <AnimatedDots />
    </span>
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
          className="text-muted-foreground hover:text-foreground self-center opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="編輯訊息並重新生成"
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
        aria-busy={message.streaming || undefined}
      >
        {message.content ? (
          message.content
        ) : message.streaming ? (
          <ThinkingIndicator />
        ) : null}
        {message.incomplete && (
          <span className="text-muted-foreground mt-1 block text-[10px]">
            （訊息中斷，請繼續對話）
          </span>
        )}
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
          aria-label="編輯訊息"
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
