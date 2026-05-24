import { MODEL, getOpenAI } from "@/lib/ai/client";
import { buildSystemPrompt } from "@/lib/ai/prompt";
import {
  type AdvancePhaseArgs,
  type CompleteFormArgs,
  tools,
} from "@/lib/ai/tools";
import { type FormRow, type MessageRow, type Phase } from "@/lib/db";
import { cookieName, verifyGateToken } from "@/lib/form-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import type OpenAI from "openai";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toOpenAIMessages(form: FormRow, rows: MessageRow[]): ChatMessageParam[] {
  const out: ChatMessageParam[] = [
    { role: "system", content: buildSystemPrompt(form) },
  ];
  for (const m of rows) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content || "" });
    }
  }
  return out;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: formId } = await params;

  // Gate check
  const token = request.cookies.get(cookieName(formId))?.value;
  if (!token || !(await verifyGateToken(token, formId))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: formData, error: formErr } = await admin
    .from("forms")
    .select("*")
    .eq("id", formId)
    .maybeSingle();
  if (formErr) return Response.json({ error: formErr.message }, { status: 500 });
  if (!formData) return Response.json({ error: "not-found" }, { status: 404 });
  const form = formData as FormRow;
  if (form.status === "completed") {
    return Response.json({ error: "form-completed" }, { status: 410 });
  }

  // Optional user message
  let body: { content?: string } = {};
  try {
    body = await request.json();
  } catch {}
  const content = String(body.content ?? "").trim();

  if (content) {
    const { error: insertErr } = await admin.from("messages").insert({
      form_id: formId,
      role: "user",
      content,
      phase: form.current_phase,
    });
    if (insertErr) {
      return Response.json({ error: insertErr.message }, { status: 500 });
    }
  }

  // Reload messages
  const { data: msgRows, error: msgErr } = await admin
    .from("messages")
    .select("*")
    .eq("form_id", formId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (msgErr) return Response.json({ error: msgErr.message }, { status: 500 });

  const openaiMessages = toOpenAIMessages(form, (msgRows ?? []) as MessageRow[]);

  const openai = getOpenAI();
  const runner = openai.chat.completions.stream({
    model: MODEL,
    messages: openaiMessages,
    tools,
    tool_choice: "auto",
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      runner.on("content", (delta) => send({ type: "text", delta }));
      runner.on("error", (err) =>
        send({ type: "error", message: String(err) }),
      );

      try {
        const final = await runner.finalChatCompletion();
        const msg = final.choices[0]?.message;
        const toolCalls = msg?.tool_calls ?? [];

        let newPhase: Phase = form.current_phase;
        let completed = false;

        for (const tc of toolCalls) {
          if (tc.type !== "function") continue;
          try {
            if (tc.function.name === "advance_phase") {
              const args = JSON.parse(tc.function.arguments) as AdvancePhaseArgs;
              newPhase = args.to_phase;
            } else if (tc.function.name === "complete_form") {
              JSON.parse(tc.function.arguments) as CompleteFormArgs;
              completed = true;
            }
          } catch {
            // Bad JSON in tool args — skip silently, the run won't crash.
          }
        }

        await admin.from("messages").insert({
          form_id: formId,
          role: "assistant",
          content: msg?.content ?? "",
          phase: form.current_phase,
          tool_calls: toolCalls.length ? toolCalls : null,
        });

        const updates: Record<string, unknown> = {};
        if (newPhase !== form.current_phase) updates.current_phase = newPhase;
        if (completed) {
          updates.status = "completed";
          updates.completed_at = new Date().toISOString();
        }
        if (Object.keys(updates).length) {
          await admin.from("forms").update(updates).eq("id", formId);
        }

        if (newPhase !== form.current_phase) {
          send({ type: "phase", to: newPhase });
        }
        if (completed) send({ type: "completed" });
        send({ type: "done" });
        controller.close();
      } catch (e) {
        send({ type: "error", message: String(e) });
        controller.close();
      }
    },
    cancel() {
      runner.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
