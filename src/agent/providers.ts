import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { HttpError } from "../serve/http.ts";

export interface Provider {
  id: string;
  name: string;
  // models yamlite's tools were checked with, offered as suggestions; the first is the default
  models: readonly string[];
  // where yamlite serve finds a key
  keyEnv: string;
}

export const PROVIDERS: readonly Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"],
    keyEnv: "ANTHROPIC_API_KEY",
  },
  { id: "openai", name: "OpenAI", models: ["gpt-5", "gpt-5-mini"], keyEnv: "OPENAI_API_KEY" },
];

export interface Credentials {
  provider: string;
  model: string;
  apiKey: string;
}

export function providerOf(id: unknown): Provider {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new HttpError(400, `unknown provider: ${String(id)}`);
  return p;
}

export function createModel(c: Credentials): LanguageModel {
  switch (c.provider) {
    case "anthropic":
      // Anthropic refuses requests from a browser origin without this header; the Cloud build calls it from a Worker
      return createAnthropic({
        apiKey: c.apiKey,
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      })(c.model);
    case "openai":
      return createOpenAI({ apiKey: c.apiKey })(c.model);
    default:
      throw new HttpError(400, `unknown provider: ${c.provider}`);
  }
}

export function envKeys(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    PROVIDERS.flatMap((p) => {
      const key = env[p.keyEnv]?.trim();
      return key ? [[p.id, key]] : [];
    }),
  );
}
