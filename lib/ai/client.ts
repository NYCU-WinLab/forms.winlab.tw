import OpenAI from "openai";

let cached: OpenAI | null = null;

export function getOpenAI() {
  if (!cached) {
    cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return cached;
}

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";
