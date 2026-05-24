import type OpenAI from "openai";
import { isPhase, type Phase } from "@/lib/db";

export const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "advance_phase",
      description:
        "當前階段 checklist 收齊時呼叫，把對話推進到下一階段。和一句話的口頭確認一起回應。Server 端會驗 to_phase 是當前階段的下一階段；跳關會被拒絕。",
      parameters: {
        type: "object",
        properties: {
          to_phase: {
            type: "string",
            enum: ["workflow", "pain", "data", "wrapup"],
            description: "要切換進去的新階段（必須是當前階段的下一階段）",
          },
          checklist_summary: {
            type: "string",
            description: "剛結束的階段收到的關鍵資訊 (1-2 句)。Server 會存起來給後續顧問看。",
          },
        },
        required: ["to_phase", "checklist_summary"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_form",
      description:
        "wrapup 階段做完 summary 跟道謝後呼叫，標記表單完成。Server 端會驗目前 phase 必須是 wrapup；其他階段呼叫會被拒絕。",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "整場對話的 1 段 summary（中文，給顧問後續看）",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
];

export type AdvanceTarget = Exclude<Phase, "context">;

export interface AdvancePhaseArgs {
  to_phase: AdvanceTarget;
  checklist_summary: string;
}

export interface CompleteFormArgs {
  summary: string;
}

// Runtime validators — never trust JSON parsed from LLM output. Returns the
// typed args on success, or null on any shape mismatch.
export function parseAdvancePhaseArgs(raw: string): AdvancePhaseArgs | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.to_phase !== "string" || !isPhase(rec.to_phase)) return null;
  if (rec.to_phase === "context") return null;
  if (typeof rec.checklist_summary !== "string") return null;
  return {
    to_phase: rec.to_phase,
    checklist_summary: rec.checklist_summary.slice(0, 2000),
  };
}

export function parseCompleteFormArgs(raw: string): CompleteFormArgs | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.summary !== "string") return null;
  return { summary: rec.summary.slice(0, 5000) };
}
