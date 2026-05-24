export type Phase = "context" | "workflow" | "pain" | "data" | "wrapup";
export const PHASES: readonly Phase[] = [
  "context",
  "workflow",
  "pain",
  "data",
  "wrapup",
] as const;

export const PHASE_LABEL_SHORT: Record<Phase, string> = {
  context: "Context",
  workflow: "Workflow",
  pain: "Pain",
  data: "Data",
  wrapup: "Wrap-up",
};

export const PHASE_LABEL_LONG: Record<Phase, string> = {
  context: "Phase 1 — Context",
  workflow: "Phase 2 — Workflow",
  pain: "Phase 3 — Pain",
  data: "Phase 4 — Data",
  wrapup: "Wrap-up",
};

export function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && (PHASES as readonly string[]).includes(value);
}

export function nextPhase(current: Phase): Phase | null {
  const idx = PHASES.indexOf(current);
  return idx >= 0 && idx < PHASES.length - 1 ? PHASES[idx + 1] : null;
}

// Transition machine: only forward-by-one; `wrapup` is terminal here (edit route
// is the only way to rewind).
export function isValidAdvance(from: Phase, to: Phase): boolean {
  return nextPhase(from) === to;
}

export type FormStatus = "open" | "completed";
export type MessageRole = "system" | "assistant" | "user" | "tool";

export interface FormRow {
  id: string;
  organization: string;
  unit: string | null;
  department: string;
  department_brief: string | null;
  access_code: string;
  access_code_version: number;
  current_phase: Phase;
  status: FormStatus;
  owner_id: string | null;
  phase_summaries: Partial<Record<Phase, string>>;
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
  incomplete: boolean;
  created_at: string;
  deleted_at: string | null;
}

export interface AuditRow {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  form_id: string | null;
  details: unknown | null;
  created_at: string;
}
