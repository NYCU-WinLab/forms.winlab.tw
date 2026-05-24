import OpenAI from "openai";

let cached: OpenAI | null = null;

export function getOpenAI() {
  if (!cached) {
    cached = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // Stream calls can stall server-side; cap each round-trip.
      timeout: 60_000,
      // SDK auto-retries transient 429/5xx with backoff.
      maxRetries: 2,
    });
  }
  return cached;
}

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";

// Per-turn output cap. Wrap-up summary is the longest legitimate response and
// rarely exceeds 1k tokens.
export const MAX_COMPLETION_TOKENS = 1500;
