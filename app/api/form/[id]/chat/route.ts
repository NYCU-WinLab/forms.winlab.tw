import { MAX_COMPLETION_TOKENS, MODEL, getOpenAI } from "@/lib/ai/client";
import { buildSystemPrompt } from "@/lib/ai/prompt";
import {
  parseAdvancePhaseArgs,
  parseCompleteFormArgs,
  tools,
} from "@/lib/ai/tools";
import {
  type FormRow,
  type MessageRow,
  type Phase,
  isValidAdvance,
} from "@/lib/db";
import { ErrorCode, errorJson, logServerError } from "@/lib/errors";
import { cookieName, verifyGateToken } from "@/lib/form-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import type OpenAI from "openai";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;

// Keep last N raw messages; older context is already represented by
// phase_summaries injected via the system prompt.
const HISTORY_TAIL = 30;
// Hard cap on a single user turn (chars). Anything beyond is rejected.
const MAX_CONTENT = 4000;
// Per-form chat rate-limit: user messages within window.
const CHAT_WINDOW_SECONDS = 60;
const CHAT_MAX_PER_WINDOW = 8;
// Hard cap on messages we'll keep persisting per form (defensive — wrap-up
// should happen well before this).
const MESSAGES_HARD_CAP = 500;

interface PersistRow {
  result: "ok" | "not_found" | "form_completed" | "phase_changed";
  current_phase: Phase | null;
  status: "open" | "completed" | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: formId } = await params;
  const token = request.cookies.get(cookieName(formId))?.value;
  const admin = createAdminClient();

  const { data: formData, error: formErr } = await admin
    .from("forms")
    .select("*")
    .eq("id", formId)
    .maybeSingle();
  if (formErr) {
    logServerError("chat.form_lookup", formErr, { formId });
    return errorJson(ErrorCode.DbError, 500);
  }
  if (!formData) return errorJson(ErrorCode.NotFound, 404);
  const form = formData as FormRow;

  if (!token || !(await verifyGateToken(token, formId, form.access_code_version))) {
    return errorJson(ErrorCode.Unauthorized, 401);
  }

  if (form.status === "completed") {
    return errorJson(ErrorCode.FormCompleted, 410);
  }

  // Parse + validate user message. An empty body is the one-shot greeting seed
  // (see app/form/[id]/page.tsx `shouldSeed`); a non-empty body is a user turn.
  let body: { content?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty/invalid body is treated as the greeting seed and gated below.
  }
  const content = String(body.content ?? "").trim();
  if (content.length > MAX_CONTENT) {
    return errorJson(ErrorCode.ContentTooLong, 413, { max: MAX_CONTENT });
  }

  // Total non-deleted messages — backs both the hard cap and the greeting
  // one-shot guard. Computed for EVERY request (not just user turns): an
  // empty-body POST must not be able to skip rate-limiting and loop the paid
  // model with no bound on calls or transcript growth.
  const { count: total, error: capErr } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId)
    .is("deleted_at", null);
  if (capErr) {
    logServerError("chat.cap_check", capErr, { formId });
    return errorJson(ErrorCode.DbError, 500);
  }
  if ((total ?? 0) >= MESSAGES_HARD_CAP) {
    return errorJson(ErrorCode.ChatRateLimited, 429);
  }

  if (!content) {
    // The greeting seed is valid exactly once, when the transcript is empty.
    // Any later empty-body POST is a scripted attempt to drive free model
    // calls — reject it so the only no-content model call is the first greeting.
    if ((total ?? 0) > 0) {
      return errorJson(ErrorCode.BadRequest, 400);
    }
  } else {
    // Per-form rate-limit on user turns (covers a leaked gate cookie scripting
    // the endpoint). Counts non-deleted user messages in the window.
    const windowStart = new Date(
      Date.now() - CHAT_WINDOW_SECONDS * 1000,
    ).toISOString();
    const { count: recent, error: rateErr } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("role", "user")
      .is("deleted_at", null)
      .gte("created_at", windowStart);
    if (rateErr) {
      logServerError("chat.rate_check", rateErr, { formId });
      return errorJson(ErrorCode.DbError, 500);
    }
    if ((recent ?? 0) >= CHAT_MAX_PER_WINDOW) {
      return errorJson(ErrorCode.ChatRateLimited, 429, {
        retry_after: CHAT_WINDOW_SECONDS,
      });
    }

    const { error: insertErr } = await admin.from("messages").insert({
      form_id: formId,
      role: "user",
      content,
      phase: form.current_phase,
    });
    if (insertErr) {
      logServerError("chat.user_insert", insertErr, { formId });
      return errorJson(ErrorCode.DbError, 500);
    }
  }

  // Load tail of history; older messages are represented by phase_summaries.
  // Use range() because Supabase JS defaults to a 1000-row cap that's easy
  // to miss.
  const { data: msgRows, error: msgErr } = await admin
    .from("messages")
    .select("id, role, content, phase, tool_calls, created_at")
    .eq("form_id", formId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(0, HISTORY_TAIL - 1);
  if (msgErr) {
    logServerError("chat.msg_lookup", msgErr, { formId });
    return errorJson(ErrorCode.DbError, 500);
  }
  const recentMessages = ((msgRows ?? []) as MessageRow[]).reverse();

  const openaiMessages = toOpenAIMessages(form, recentMessages);

  const openai = getOpenAI();
  const encoder = new TextEncoder();

  // Tracked so the ReadableStream's cancel() can abort whichever model call is
  // currently in flight across the agent loop.
  let activeRunner: ReturnType<typeof openai.chat.completions.stream> | null =
    null;

  // Bounds the agent loop. A user turn needs at most two model calls: the first
  // (tools enabled) may advance the phase; the second (tools disabled) asks the
  // new phase's opening question so the conversation doesn't dead-end on the
  // transition sentence. The extra slot is pure paranoia against runaway.
  const MAX_MODEL_CALLS = 3;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // Controller may already be closing — swallow.
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      // Interview state threaded across loop iterations. `livePhase` tracks the
      // phase after applied advances; `expectedPhase` is the optimistic-lock
      // expectation handed to chat_persist_turn each round.
      let workingMessages: ChatMessageParam[] = openaiMessages;
      let livePhase: Phase = form.current_phase;
      let expectedPhase: Phase = form.current_phase;
      const summaries: Partial<Record<Phase, string>> = {
        ...form.phase_summaries,
      };
      // First call lets the model drive phase transitions; continuation calls
      // disable tools so the model can only produce the next question (no
      // chain-advance, no second dead-end).
      let allowTools = true;

      for (let call = 0; call < MAX_MODEL_CALLS; call++) {
        const runner = openai.chat.completions.stream({
          model: MODEL,
          messages: workingMessages,
          tools,
          tool_choice: allowTools ? "auto" : "none",
          max_completion_tokens: MAX_COMPLETION_TOKENS,
        });
        activeRunner = runner;

        // Accumulate content for partial-flush recovery if the run is aborted.
        let contentBuf = "";
        runner.on("content", (delta) => {
          contentBuf += delta;
          send({ type: "text", delta });
        });

        let final;
        try {
          final = await runner.finalChatCompletion();
        } catch (e) {
          // Common reject paths:
          //   • User abort     — `runner.aborted` is true. Persist what we have.
          //   • OpenAI 429/5xx — SDK already retried via maxRetries.
          //   • Network blip   — persist partial, surface friendly.
          const aborted = runner.aborted;
          if (contentBuf.length > 0) {
            const { error: partialErr } = await admin.rpc("chat_persist_turn", {
              p_form_id: formId,
              p_expected_phase: expectedPhase,
              p_content: contentBuf,
              p_phase: livePhase,
              p_tool_calls: null,
              p_incomplete: true,
              p_new_phase: null,
              p_summary_for_old_phase: null,
              p_complete: false,
            });
            if (partialErr) {
              logServerError("chat.partial_persist", partialErr, { formId });
            }
          }
          if (!aborted) {
            logServerError("chat.stream", e, { formId });
            send({ type: "error", code: ErrorCode.UpstreamError });
          }
          close();
          return;
        }

        const msg = final.choices[0]?.message;
        const rawToolCalls = (msg?.tool_calls ?? []) as ReadonlyArray<{
          type?: string;
        }>;
        const toolCalls: ChatTool[] = rawToolCalls.filter(
          (tc): tc is ChatTool => tc.type === "function",
        );

        // Validate tool calls against the server-side transition machine.
        let newPhase: Phase = livePhase;
        let summaryForOldPhase: string | null = null;
        let completed = false;

        for (const tc of toolCalls) {
          if (tc.function.name === "advance_phase") {
            const args = parseAdvancePhaseArgs(tc.function.arguments);
            if (!args) {
              logServerError("chat.bad_advance_args", null, {
                formId,
                raw: tc.function.arguments,
              });
              continue;
            }
            if (!isValidAdvance(livePhase, args.to_phase)) {
              logServerError("chat.bad_advance_target", null, {
                formId,
                from: livePhase,
                to: args.to_phase,
              });
              continue;
            }
            newPhase = args.to_phase;
            summaryForOldPhase = args.checklist_summary;
          } else if (tc.function.name === "complete_form") {
            const args = parseCompleteFormArgs(tc.function.arguments);
            if (!args) {
              logServerError("chat.bad_complete_args", null, {
                formId,
                raw: tc.function.arguments,
              });
              continue;
            }
            if (livePhase !== "wrapup") {
              logServerError("chat.complete_out_of_phase", null, {
                formId,
                phase: livePhase,
              });
              continue;
            }
            completed = true;
          }
        }

        const advanced = newPhase !== livePhase;

        // Persist assistant turn atomically with the phase advance under an
        // advisory lock. If the phase changed since we read it (another tab),
        // the RPC reports phase_changed and we surface that to the client.
        const persistResult = await admin.rpc("chat_persist_turn", {
          p_form_id: formId,
          p_expected_phase: expectedPhase,
          p_content: msg?.content ?? "",
          p_phase: newPhase,
          p_tool_calls: toolCalls.length
            ? (toolCalls as unknown as object)
            : null,
          p_incomplete: false,
          p_new_phase: advanced ? newPhase : null,
          p_summary_for_old_phase: summaryForOldPhase,
          p_complete: completed,
        });
        const persist = persistResult.data as PersistRow[] | null;

        if (persistResult.error || !persist || persist.length === 0) {
          logServerError("chat.persist_rpc", persistResult.error, { formId });
          // The assistant turn was NOT stored — tell the client to drop the
          // streamed bubble so it doesn't linger as a phantom message.
          send({ type: "discard" });
          send({ type: "error", code: ErrorCode.DbError });
          close();
          return;
        }

        const row = persist[0]!;
        if (row.result === "phase_changed") {
          // Client refreshes from the server snapshot, which already drops the
          // un-persisted bubble — no explicit discard needed.
          send({ type: "error", code: ErrorCode.PhaseChanged });
          close();
          return;
        }
        if (row.result === "form_completed") {
          send({ type: "discard" });
          send({ type: "error", code: ErrorCode.FormCompleted });
          close();
          return;
        }
        if (row.result !== "ok") {
          send({ type: "discard" });
          send({ type: "error", code: ErrorCode.DbError });
          close();
          return;
        }

        if (advanced) {
          send({ type: "phase", to: newPhase });
          if (summaryForOldPhase) summaries[livePhase] = summaryForOldPhase;
          livePhase = newPhase;
          expectedPhase = newPhase;
        }
        if (completed) {
          send({ type: "completed" });
          break;
        }

        // After an advance, loop once more (tools off) so the model asks the
        // new phase's opening question instead of stopping on the transition.
        if (advanced) {
          const refreshed = buildSystemPrompt({
            ...form,
            current_phase: livePhase,
            phase_summaries: summaries,
          });
          const assistantMsg: ChatMessageParam = {
            role: "assistant",
            content: msg?.content || null,
            tool_calls: toolCalls,
          };
          const toolResults: ChatMessageParam[] = toolCalls.map((tc) => ({
            role: "tool",
            tool_call_id: tc.id,
            content: "applied",
          }));
          workingMessages = [
            { role: "system", content: refreshed.stable },
            { role: "system", content: refreshed.dynamic },
            ...workingMessages.slice(2),
            assistantMsg,
            ...toolResults,
          ];
          allowTools = false;
          // Tell the client to close this transition bubble and open a fresh
          // one for the follow-up question, matching how the two persisted
          // messages render on reload.
          send({ type: "split" });
          continue;
        }

        // Plain Q&A turn (or the post-advance question) — nothing more to do.
        break;
      }

      send({ type: "done" });
      close();
    },
    cancel() {
      activeRunner?.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (Caddy / nginx) so SSE chunks reach the client
      // as they're emitted.
      "X-Accel-Buffering": "no",
    },
  });
}

function toOpenAIMessages(
  form: FormRow,
  rows: MessageRow[],
): ChatMessageParam[] {
  const { stable, dynamic } = buildSystemPrompt(form);
  const out: ChatMessageParam[] = [
    { role: "system", content: stable },
    { role: "system", content: dynamic },
  ];

  for (const m of rows) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      // Reconstruct assistant turns with their tool_calls so the model sees
      // its own prior tool usage. Each tool_call must be followed by a `tool`
      // role result message; we use a no-op stub since server has already
      // applied the call's effect (phase advance / completion).
      const toolCalls: ChatTool[] = Array.isArray(m.tool_calls)
        ? (m.tool_calls as unknown[]).filter(
            (tc): tc is ChatTool =>
              typeof tc === "object" &&
              tc !== null &&
              (tc as { type?: unknown }).type === "function",
          )
        : [];

      if (toolCalls.length > 0) {
        out.push({
          role: "assistant",
          content: m.content || null,
          tool_calls: toolCalls,
        });
        for (const tc of toolCalls) {
          out.push({
            role: "tool",
            tool_call_id: tc.id,
            content: "applied",
          });
        }
      } else if (m.content) {
        out.push({ role: "assistant", content: m.content });
      }
    }
  }

  return out;
}
