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

test("createModel with baseURL leaves out the browser header", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const spy = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  const call = async (baseURL?: string) => {
    const model = createModel({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k", baseURL, fetch: spy });
    const prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    await (model as any).doGenerate({ prompt }).catch(() => {});
  };
  await call("https://h/anthropic/v1");
  await call();
  expect(calls[0]?.url).toMatch(/^https:\/\/h\/anthropic\/v1\/messages/);
  expect(calls[0]?.headers.has("anthropic-dangerous-direct-browser-access")).toBe(false);
  expect(calls[1]?.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
});
