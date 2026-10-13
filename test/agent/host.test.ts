import type { LanguageModel } from "ai";
import { APICallError } from "ai";
import { afterEach, expect, test } from "vitest";
import type { AgentEvent } from "../../src/agent/types.ts";
import { AgentHost, type Conversation, type HostOptions } from "../../src/agent/host.ts";
import type { Credentials } from "../../src/agent/providers.ts";
import type { AgentTool } from "../../src/agent/tools.ts";
import { waitFor } from "../helpers.ts";
import { hanging, promptText, scripted } from "./model.ts";

const TOOLS: AgentTool[] = [
  {
    name: "schema",
    description: "tables",
    inputSchema: { type: "object", properties: {} },
    call: () => ({ tables: ["tasks"] }),
  },
  {
    name: "boom",
    description: "fails",
    inputSchema: { type: "object", properties: {} },
    call: () => {
      throw new Error("unknown table: nope");
    },
  },
];

let host: AgentHost | undefined;
afterEach(async () => {
  await host?.close();
  host = undefined;
});

function makeHost(models: LanguageModel[], o: Partial<HostOptions> = {}) {
  const made: Credentials[] = [];
  host = new AgentHost({
    tools: () => TOOLS,
    feedback: () => [],
    keys: { anthropic: "env-key" },
    createModel: (c) => {
      made.push(c);
      return models.shift() as LanguageModel;
    },
    ...o,
  });
  return { host, made };
}

const idle = (c: Conversation) => waitFor(() => !c.busy);
const types = (c: Conversation) => c.events.map((e) => e.type);
const tools = (c: Conversation) =>
  c.events.filter((e): e is Extract<AgentEvent, { type: "tool" }> => e.type === "tool");

test("a turn runs tools, streams text and keeps the history for the next turn", async () => {
  const model = scripted([{ tools: [{ name: "schema" }] }, { say: "There is one table." }, { say: "Still one." }]);
  const { host } = makeHost([model]);
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "what tables?");
  await idle(c);
  expect(types(c)).toEqual(["user", "busy", "tool", "tool", "text", "busy"]);
  expect(tools(c).map((e) => e.status)).toEqual(["in_progress", "completed"]);
  expect(tools(c)[0]).toMatchObject({ title: "schema", input: {} });
  host.prompt(c.id, "and now?");
  await idle(c);
  expect(promptText(model, 2)).toContain("There is one table.");
  expect(promptText(model, 2)).toContain("tasks");
});

test("the system prompt holds the preamble and the notes", async () => {
  const model = scripted([{ say: "ok" }]);
  const { host } = makeHost([model], { notes: ["NOTE-1"] });
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "hi");
  await idle(c);
  const prompt = model.doStreamCalls[0]?.prompt ?? [];
  expect(prompt[0]).toMatchObject({ role: "system" });
  expect(JSON.stringify(prompt[0])).toContain("YAMLite");
  expect(JSON.stringify(prompt[0])).toContain("NOTE-1");
});

test("queued feedback goes in front of the next user message", async () => {
  const model = scripted([{ say: "ok" }]);
  const queue = ["Proposal p1 was applied."];
  const { host } = makeHost([model], { feedback: () => queue.splice(0) });
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "next");
  await idle(c);
  expect(promptText(model, 0)).toContain("Proposal p1 was applied.\\nnext");
});

test("a failing tool is reported and the turn goes on", async () => {
  const model = scripted([{ tools: [{ name: "boom" }] }, { say: "That table does not exist." }]);
  const { host } = makeHost([model]);
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "read nope");
  await idle(c);
  expect(tools(c).map((e) => e.status)).toEqual(["in_progress", "failed"]);
  expect(promptText(model, 1)).toContain("unknown table: nope");
  expect(c.events.at(-2)).toEqual({ type: "text", text: "That table does not exist." });
});

test("a rejected key is an auth error and the turn is rolled back", async () => {
  const rejected = new APICallError({ message: "invalid x-api-key", url: "u", requestBodyValues: {}, statusCode: 401 });
  const model = scripted([rejected, { say: "ok" }]);
  const { host } = makeHost([model]);
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "rejected question");
  await idle(c);
  expect(c.events.find((e) => e.type === "error")).toEqual({
    type: "error",
    code: "auth",
    message: "invalid x-api-key",
  });
  expect(c.messages).toEqual([]);
  host.prompt(c.id, "second");
  await idle(c);
  expect(promptText(model, 1)).not.toContain("rejected question");
});

test("a provider error ends the turn and the next one works", async () => {
  const model = scripted([new Error("overloaded"), { say: "back" }]);
  const { host } = makeHost([model]);
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "one");
  await idle(c);
  expect(c.events.find((e) => e.type === "error")).toEqual({ type: "error", message: "overloaded" });
  host.prompt(c.id, "two");
  await idle(c);
  expect(c.events.at(-2)).toEqual({ type: "text", text: "back" });
});

test("cancel ends a running turn and drops it from the history", async () => {
  const { host } = makeHost([hanging()]);
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "slow");
  await waitFor(() => c.events.some((e) => e.type === "text"));
  host.cancel(c.id);
  await idle(c);
  expect(c.messages).toEqual([]);
  expect(c.events.at(-1)).toEqual({ type: "busy", busy: false });
});

test("a prompt while busy is refused with 409", async () => {
  const { host } = makeHost([hanging()]);
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "slow");
  expect(() => host.prompt(c.id, "again")).toThrow(expect.objectContaining({ status: 409 }));
  host.cancel(c.id);
  await idle(c);
});

test("start checks the provider, the model and the key", () => {
  const { host, made } = makeHost([scripted([]), scripted([]), scripted([])], { keys: { anthropic: "env-key" } });
  expect(() => host.start({ provider: "nope" })).toThrow(expect.objectContaining({ status: 400 }));
  expect(() => host.start({ provider: "anthropic", model: 5 })).toThrow(expect.objectContaining({ status: 400 }));
  expect(() => host.start({ provider: "openai" })).toThrow(
    expect.objectContaining({ status: 400, extra: { code: "no_key" } }),
  );
  host.start({ provider: "anthropic" });
  host.start({ provider: "openai", model: "gpt-5-mini", apiKey: " sk-o " });
  host.start({ provider: "anthropic", model: " claude-next-6 " });
  expect(made).toEqual([
    { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "env-key" },
    { provider: "openai", model: "gpt-5-mini", apiKey: "sk-o" },
    { provider: "anthropic", model: "claude-next-6", apiKey: "env-key" },
  ]);
});

test("providers says which keys the host holds", () => {
  const { host } = makeHost([]);
  expect(host.providers().map(({ id, hasKey }) => ({ id, hasKey }))).toEqual([
    { id: "anthropic", hasKey: true },
    { id: "openai", hasKey: false },
  ]);
});

test("the list is newest first and end closes a conversation", async () => {
  const { host } = makeHost([scripted([{ say: "a" }]), scripted([{ say: "b" }])]);
  const first = host.start({ provider: "anthropic" });
  host.prompt(first.id, "first question");
  await idle(first);
  const second = host.start({ provider: "anthropic" });
  host.prompt(second.id, "second question");
  await idle(second);
  expect(host.list().map((s) => s.title)).toEqual(["second question", "first question"]);
  expect(host.list()[0]).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
  const seen: AgentEvent[] = [];
  first.subscribe((e) => seen.push(e));
  host.end(first.id);
  expect(seen).toEqual([{ type: "closed" }]);
  expect(host.get(first.id)).toBeUndefined();
});

test("past the limit the oldest idle conversation is dropped", () => {
  const { host } = makeHost([scripted([]), scripted([]), scripted([])], { maxConversations: 2 });
  const a = host.start({ provider: "anthropic" });
  host.start({ provider: "anthropic" });
  host.start({ provider: "anthropic" });
  expect(host.get(a.id)).toBeUndefined();
  expect(host.list()).toHaveLength(2);
});

test("close stops running turns", async () => {
  const { host } = makeHost([hanging()]);
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "slow");
  await host.close();
  await idle(c);
  expect(() => host.start({ provider: "anthropic" })).toThrow(expect.objectContaining({ status: 503 }));
});

test("feedback consumed by a failed turn is carried to the next one", async () => {
  const model = scripted([new Error("overloaded"), { say: "ok" }]);
  const queue = ["Proposal p1 was applied."];
  const { host } = makeHost([model], { feedback: () => queue.splice(0) });
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "one");
  await idle(c);
  host.prompt(c.id, "two");
  await idle(c);
  expect(promptText(model, 1)).toContain("Proposal p1 was applied.");
});

test("an error while setting up a turn is reported and the next turn works", async () => {
  let calls = 0;
  const { host } = makeHost([scripted([{ say: "fine" }])], {
    tools: () => {
      if (calls++ === 0) throw new Error("tools broke");
      return TOOLS;
    },
  });
  const c = host.start({ provider: "anthropic" });
  host.prompt(c.id, "one");
  await idle(c);
  expect(c.events.find((e) => e.type === "error")).toEqual({ type: "error", message: "tools broke" });
  expect(c.messages).toEqual([]);
  host.prompt(c.id, "two");
  await idle(c);
  expect(c.events.at(-2)).toEqual({ type: "text", text: "fine" });
});
