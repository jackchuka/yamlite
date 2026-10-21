import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { Credentials } from "../../src/agent/providers.ts";
import { scripted, type Reply } from "../agent/model.ts";
import { read, waitFor } from "../helpers.ts";
import { type Served, startServe, waitForAsync } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

async function withAi(
  replies: Reply[],
  files: Record<string, string>,
  keys: Record<string, string> = { anthropic: "k" },
) {
  const made: Credentials[] = [];
  t = await startServe(files, undefined, {
    ai: {
      keys,
      createModel: (c) => {
        made.push(c);
        return scripted(replies);
      },
    },
  });
  return { t, made };
}

async function eventsOf(t: Served, id: string) {
  const res = await fetch(`${t.base}/api/agent/conversations/${id}/events`, { headers: { cookie: t.cookie } });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const got: any[] = [];
  let buf = "";
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += value;
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        const data = /^data: (.*)$/m.exec(buf.slice(0, i))?.[1];
        buf = buf.slice(i + 2);
        if (data) got.push(JSON.parse(data));
      }
    }
  })().catch(() => {});
  return { got, close: () => reader.cancel().catch(() => {}) };
}

test("ask → proposal → apply → YAML keeps its comment", async () => {
  const { t } = await withAi(
    [
      {
        tools: [
          { name: "propose_sql", args: { title: "errands done", sql: "UPDATE tasks SET done = 1 WHERE id = 'a'" } },
        ],
      },
      { say: "Review the card above." },
    ],
    { "tasks/a.yaml": "# keep\ntitle: A\ndone: false\n" },
  );
  const { body } = await t.api("/api/agent/conversations", { method: "POST", body: { provider: "anthropic" } });
  const ev = await eventsOf(t, body.id);
  const sent = await t.api(`/api/agent/conversations/${body.id}/prompt`, {
    method: "POST",
    body: { text: "全部完了にして" },
  });
  expect(sent.status).toBe(202);
  await waitFor(() => ev.got.some((e) => e.type === "proposal"));
  const [p] = (await t.api("/api/agent/proposals")).body.proposals;
  expect(read(join(t.root, "tasks/a.yaml"))).toContain("done: false");
  await t.api(`/api/agent/proposals/${p.id}/apply`, { method: "POST" });
  await waitFor(() => read(join(t.root, "tasks/a.yaml")) === "# keep\ntitle: A\ndone: true\n");
  ev.close();
});

test("discard leaves the files alone", async () => {
  const { t } = await withAi(
    [{ tools: [{ name: "propose_sql", args: { title: "x", sql: "UPDATE tasks SET done = 1" } }] }, { say: "ok" }],
    { "tasks/a.yaml": "title: A\ndone: false\n" },
  );
  const { body } = await t.api("/api/agent/conversations", { method: "POST", body: { provider: "anthropic" } });
  await t.api(`/api/agent/conversations/${body.id}/prompt`, { method: "POST", body: { text: "x" } });
  await waitForAsync(async () => (await t.api("/api/agent/proposals")).body.proposals.length === 1);
  const [p] = (await t.api("/api/agent/proposals")).body.proposals;
  await t.api(`/api/agent/proposals/${p.id}/discard`, { method: "POST" });
  expect(read(join(t.root, "tasks/a.yaml"))).toBe("title: A\ndone: false\n");
});

test("meta lists the providers and which keys serve holds", async () => {
  const { t } = await withAi([], { "tasks/a.yaml": "title: A\n" });
  const ai = (await t.api("/api/meta")).body.ai;
  expect(ai.providers.map(({ id, hasKey }: any) => ({ id, hasKey }))).toEqual([
    { id: "anthropic", hasKey: true },
    { id: "openai", hasKey: false },
  ]);
});

test("meta lists the host's default provider first", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, undefined, {
    ai: { keys: { anthropic: "a", openai: "o" }, defaultProvider: "openai" },
  });
  const ai = (await t.api("/api/meta")).body.ai;
  expect(ai.providers.map((p: any) => p.id)).toEqual(["openai", "anthropic"]);
});

test("agent: false hides the feature", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, undefined, { agent: false });
  expect((await t.api("/api/meta")).body.ai).toBeNull();
  const res = await t.api("/api/agent/conversations", { method: "POST", body: { provider: "anthropic" } });
  expect(res.status).toBe(404);
});

test("starting without a key is 400 no_key; a key in the body is used", async () => {
  const { t, made } = await withAi([], { "tasks/a.yaml": "title: A\n" }, {});
  const missing = await t.api("/api/agent/conversations", { method: "POST", body: { provider: "openai" } });
  expect(missing.status).toBe(400);
  expect(missing.body.code).toBe("no_key");
  const ok = await t.api("/api/agent/conversations", {
    method: "POST",
    body: { provider: "openai", model: "gpt-5-mini", apiKey: "sk-user" },
  });
  expect(ok.status).toBe(201);
  expect(made).toEqual([{ provider: "openai", model: "gpt-5-mini", apiKey: "sk-user" }]);
});

test("DELETE sends closed to subscribers and ends the stream", async () => {
  const { t } = await withAi([], { "tasks/a.yaml": "title: A\n" });
  const { body } = await t.api("/api/agent/conversations", { method: "POST", body: { provider: "anthropic" } });
  const ev = await eventsOf(t, body.id);
  await t.api(`/api/agent/conversations/${body.id}`, { method: "DELETE" });
  await waitFor(() => ev.got.some((e) => e.type === "closed"));
});

test("the conversation list is newest first with title, provider and model", async () => {
  const { t } = await withAi([{ say: "ok" }], { "tasks/a.yaml": "title: A\n" });
  const { body } = await t.api("/api/agent/conversations", { method: "POST", body: { provider: "anthropic" } });
  await t.api(`/api/agent/conversations/${body.id}/prompt`, { method: "POST", body: { text: "hello there" } });
  await waitForAsync(async () => (await t.api("/api/agent/conversations")).body.conversations[0]?.title !== "");
  const list = (await t.api("/api/agent/conversations")).body.conversations;
  expect(list[0]).toMatchObject({
    id: body.id,
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    title: "hello there",
  });
});
