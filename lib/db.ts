export type Phase = "context" | "workflow" | "pain" | "data" | "wrapup";
export const PHASES: Phase[] = ["context", "workflow", "pain", "data", "wrapup"];

export type FormStatus = "open" | "completed";
export type MessageRole = "system" | "assistant" | "user";

export interface FormRow {
  id: string;
  organization: string;
  unit: string | null;
  department: string;
  department_brief: string | null;
  access_code: string;
  current_phase: Phase;
  status: FormStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface MessageRow {
  id: string;
  form_id: string;
  role: MessageRole;
  content: string;
  phase: Phase | null;
  tool_calls: unknown | null;
  created_at: string;
  deleted_at: string | null;
}
