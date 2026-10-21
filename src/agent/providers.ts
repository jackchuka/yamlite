import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { LanguageModel, Tool } from "ai";
import { HttpError } from "../serve/http.ts";

// each search is billed to the key, so one answer is kept from running up many
const MAX_SEARCHES = 10;

export interface Credentials {
  provider: string;
  model: string;
  apiKey: string;
  // routes the SDK through another URL, e.g. the host's own proxy
  baseURL?: string;
  fetch?: typeof fetch;
}

export interface Provider {
  id: string;
  name: string;
  // models yamlite's tools were checked with, offered as suggestions; the first is the default
  models: readonly string[];
  // where yamlite serve finds a key
  keyEnv: string;
  model: (c: Credentials) => LanguageModel;
  // searches run on the provider's side, so the host never fetches the web itself
  webSearch: () => Tool;
}

export const PROVIDERS: readonly Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"],
    keyEnv: "ANTHROPIC_API_KEY",
    // Anthropic refuses requests from a browser origin without this header; the Cloud build calls it from a Worker.
    // A host's proxy takes the request itself, so it does not need it.
    model: (c) =>
      createAnthropic({
        apiKey: c.apiKey,
        baseURL: c.baseURL,
        fetch: c.fetch,
        ...(c.baseURL ? {} : { headers: { "anthropic-dangerous-direct-browser-access": "true" } }),
      })(c.model),
    webSearch: () => anthropic.tools.webSearch_20260318({ maxUses: MAX_SEARCHES }),
  },
  {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-5", "gpt-5-mini"],
    keyEnv: "OPENAI_API_KEY",
    model: (c) => createOpenAI({ apiKey: c.apiKey, baseURL: c.baseURL, fetch: c.fetch })(c.model),
    webSearch: () => openai.tools.webSearch(),
  },
];

export function providerOf(id: unknown): Provider {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new HttpError(400, `unknown provider: ${String(id)}`);
  return p;
}

export const createModel = (c: Credentials): LanguageModel => providerOf(c.provider).model(c);

export function envKeys(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    PROVIDERS.flatMap((p) => {
      const key = env[p.keyEnv]?.trim();
      return key ? [[p.id, key]] : [];
    }),
  );
}
