import { afterEach, expect, test } from "vitest";
import { type AiProvider, currentChoice, saveChoice } from "./ai";

const PROVIDERS: AiProvider[] = [
  { id: "anthropic", name: "Anthropic", models: ["claude-sonnet-5-5", "claude-haiku-5-5"], hasKey: false },
  { id: "openai", name: "OpenAI", models: ["gpt-5", "gpt-5-mini"], hasKey: false },
];
afterEach(() => localStorage.clear());

test("no key anywhere means no choice yet", () => {
  expect(currentChoice(PROVIDERS)).toBeNull();
});

test("a server key is used when nothing was saved", () => {
  const withServerKey = PROVIDERS.map((p) => (p.id === "openai" ? { ...p, hasKey: true } : p));
  expect(currentChoice(withServerKey)).toEqual({ provider: "openai", model: "gpt-5", apiKey: "" });
});

test("a remembered key survives in localStorage; a key not remembered does not", () => {
  saveChoice({ provider: "openai", model: "gpt-5-mini", apiKey: "sk-1" }, true);
  expect(JSON.parse(localStorage.getItem("yamlite-ai") ?? "{}").keys).toEqual({ openai: "sk-1" });
  expect(currentChoice(PROVIDERS)).toEqual({ provider: "openai", model: "gpt-5-mini", apiKey: "sk-1" });
  saveChoice({ provider: "openai", model: "gpt-5-mini", apiKey: "sk-2" }, false);
  expect(JSON.parse(localStorage.getItem("yamlite-ai") ?? "{}").keys).toEqual({});
  expect(currentChoice(PROVIDERS)?.apiKey).toBe("sk-2");
});

test("a saved model outside the suggestions is kept", () => {
  saveChoice({ provider: "anthropic", model: "claude-next-6", apiKey: "k" }, true);
  expect(currentChoice(PROVIDERS)?.model).toBe("claude-next-6");
});

test("a model saved for another provider is not carried over", () => {
  saveChoice({ provider: "removed-provider", model: "x-1", apiKey: "k" }, true);
  expect(currentChoice(PROVIDERS.map((p) => ({ ...p, hasKey: true })))?.model).toBe("claude-sonnet-5-5");
});
