import type OpenAI from "openai";

export const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "advance_phase",
      description:
        "當前階段 checklist 收齊時呼叫，把對話推進到下一階段。和一句話的口頭確認一起回應。",
      parameters: {
        type: "object",
        properties: {
          to_phase: {
            type: "string",
            enum: ["workflow", "pain", "data", "wrapup"],
            description: "要切換進去的新階段",
          },
          checklist_summary: {
            type: "string",
            description: "剛結束的階段收到的關鍵資訊 (1-2 句)",
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
      description: "wrapup 階段做完 summary 跟道謝後呼叫，標記表單完成。",
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

export interface AdvancePhaseArgs {
  to_phase: "workflow" | "pain" | "data" | "wrapup";
  checklist_summary: string;
}

export interface CompleteFormArgs {
  summary: string;
}
