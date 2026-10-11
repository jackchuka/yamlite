import { expect, test } from "vitest";
import { createModel, envKeys, PROVIDERS, providerOf } from "../../src/agent/providers.ts";

test("envKeys takes the keys of known providers and skips blank ones", () => {
  expect(envKeys({ ANTHROPIC_API_KEY: " sk-a ", OPENAI_API_KEY: "", OTHER_API_KEY: "x" })).toEqual({
    anthropic: "sk-a",
  });
});

test("providerOf refuses an unknown provider with 400", () => {
  expect(() => providerOf("nope")).toThrow(expect.objectContaining({ status: 400 }));
  expect(providerOf("openai").name).toBe("OpenAI");
});

test("createModel builds a model for every provider's models", () => {
  for (const p of PROVIDERS)
    for (const model of p.models) {
      const m = createModel({ provider: p.id, model, apiKey: "k" }) as { modelId: string };
      expect(m.modelId).toBe(model);
    }
});
