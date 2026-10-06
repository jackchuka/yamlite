import { request } from "node:http";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { read, tmpRoot, waitFor } from "../helpers.ts";
import { type Served, startServe, waitForAsync } from "./helpers.ts";

// each test spawns agent processes; under a full parallel run that takes longer than the default 5s
vi.setConfig({ testTimeout: 30_000 });

const FAKE = resolve(import.meta.dirname, "../fixtures/fake-agent.mjs");
let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
  delete process.env.FAKE_AGENT_SCENARIO;
  delete process.env.FAKE_AGENT_MCP_ON_START;
  delete process.env.FAKE_AGENT_STATE_DIR;
});

async function withAgent(turns: unknown[][], files: Record<string, string>) {
  const scenario = join(tmpRoot(), "scenario.json");
  writeFileSync(scenario, JSON.stringify(turns));
  process.env.FAKE_AGENT_SCENARIO = scenario;
  process.env.FAKE_AGENT_STATE_DIR = tmpRoot();
  t = await startServe(files, undefined, {
    agents: [{ id: "test", name: "Test agent", command: process.execPath, args: [FAKE], login: "login" }],
  });
  return t;
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
  const t = await withAgent(
    [
      [{ mcp: "propose_sql", args: { title: "errands done", sql: "UPDATE tasks SET done = 1 WHERE id = 'a'" } }],
      [{ echo: true }],
    ],
    { "tasks/a.yaml": "# keep\ntitle: A\ndone: false\n" },
  );
  expect((await t.api("/api/meta")).body.agents).toEqual([{ id: "test", name: "Test agent", login: "login" }]);
  const { body } = await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } });
  const ev = await eventsOf(t, body.id);
  expect(
    (await t.api(`/api/agent/conversations/${body.id}/prompt`, { method: "POST", body: { text: "全部完了にして" } }))
      .status,
  ).toBe(202);
  await waitFor(() => ev.got.some((e) => e.type === "proposal"));
  const pending = (await t.api("/api/agent/proposals")).body.proposals;
  expect(pending).toHaveLength(1);
  expect(read(join(t.root, "tasks/a.yaml"))).toContain("done: false");
  const applied = await t.api(`/api/agent/proposals/${pending[0].id}/apply`, { method: "POST" });
  expect(applied.body.status).toBe("applied");
  await waitFor(() => read(join(t.root, "tasks/a.yaml")) === "# keep\ntitle: A\ndone: true\n");
  await waitFor(() => ev.got.some((e) => e.type === "busy" && e.busy === false));
  await t.api(`/api/agent/conversations/${body.id}/prompt`, { method: "POST", body: { text: "next" } });
  await waitFor(() => ev.got.some((e) => e.type === "text" && /applied proposal/.test(e.text)));
  await ev.close();
});

test("discard leaves the files alone", async () => {
  const t = await withAgent(
    [[{ mcp: "propose_changes", args: { title: "drop", changes: [{ table: "tasks", key: "a", op: "delete" }] } }]],
    { "tasks/a.yaml": "title: A\n" },
  );
  const { body } = await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } });
  await t.api(`/api/agent/conversations/${body.id}/prompt`, { method: "POST", body: { text: "x" } });
  await waitForAsync(async () => (await t.api("/api/agent/proposals")).body.proposals.length === 1, 10_000);
  const [p] = (await t.api("/api/agent/proposals")).body.proposals;
  expect((await t.api(`/api/agent/proposals/${p.id}/discard`, { method: "POST" })).body.status).toBe("discarded");
  expect(read(join(t.root, "tasks/a.yaml"))).toBe("title: A\n");
});

test("/mcp needs the conversation's token and no Origin", async () => {
  const t = await withAgent([[{ say: "hi" }]], { "tasks/a.yaml": "title: A\n" });
  const call = (headers: Record<string, string>, method = "POST") =>
    new Promise<{ status: number; json: () => Promise<any> }>((done, fail) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: t.s.port,
          path: "/mcp",
          method,
          headers: { "content-type": "application/json", ...headers },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c: string) => (text += c));
          res.on("end", () => done({ status: res.statusCode ?? 0, json: async () => JSON.parse(text) }));
        },
      );
      req.on("error", fail);
      req.end(method === "POST" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) : undefined);
    });
  expect((await call({})).status).toBe(401);
  expect((await call({ authorization: `Bearer ${t.s.token}` })).status).toBe(401);
  const { body } = await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } });
  const token = t.s.context.agent!.get(body.id)!.token;
  const ok = await call({ authorization: `Bearer ${token}` });
  expect(ok.status).toBe(200);
  expect((await ok.json()).result.tools.map((x: any) => x.name)).toContain("propose_sql");
  expect((await call({ authorization: `Bearer ${token}` }, "GET")).status).toBe(405);
  expect((await call({ authorization: `Bearer ${token}`, origin: "http://evil.example" })).status).toBe(403);
  expect((await call({ authorization: `Bearer ${token}`, host: "evil.example" })).status).toBe(403);
  await t.api(`/api/agent/conversations/${body.id}`, { method: "DELETE" });
  expect((await call({ authorization: `Bearer ${token}` })).status).toBe(401);
});

test("agent: false and no agents both hide the feature", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, undefined, { agent: false });
  expect((await t.api("/api/meta")).body.agents).toEqual([]);
  expect(t.s.context.agent).toBeNull();
  expect((await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } })).status).toBe(404);
});

test("a login failure is reported with its code", async () => {
  process.env.FAKE_AGENT_LOGIN = "1";
  try {
    const t = await withAgent([[]], { "tasks/a.yaml": "title: A\n" });
    const res = await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } });
    expect(res).toMatchObject({ status: 502, body: { code: "login" } });
  } finally {
    delete process.env.FAKE_AGENT_LOGIN;
  }
});

test("DELETE sends closed to subscribers and ends the stream", async () => {
  const t = await withAgent([[{ say: "hi" }]], { "tasks/a.yaml": "title: A\n" });
  const { body } = await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } });
  const ev = await eventsOf(t, body.id);
  await t.api(`/api/agent/conversations/${body.id}`, { method: "DELETE" });
  await waitFor(() => ev.got.some((e) => e.type === "closed"));
  await ev.close();
});

test("the agent reaches /mcp when serving on ::1", async (ctx) => {
  const scenario = join(tmpRoot(), "scenario.json");
  writeFileSync(
    scenario,
    JSON.stringify([[{ mcp: "propose_sql", args: { title: "x", sql: "UPDATE tasks SET done = 1" } }]]),
  );
  process.env.FAKE_AGENT_SCENARIO = scenario;
  try {
    t = await startServe({ "tasks/a.yaml": "title: A\ndone: false\n" }, undefined, {
      host: "::1",
      agents: [{ id: "test", name: "Test agent", command: process.execPath, args: [FAKE], login: "login" }],
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRNOTAVAIL") return ctx.skip();
    throw e;
  }
  const { body } = await fetch(`http://[::1]:${t.s.port}/api/agent/conversations`, {
    method: "POST",
    headers: { cookie: t.cookie, "content-type": "application/json" },
    body: JSON.stringify({ agent: "test" }),
  }).then(async (r) => ({ body: (await r.json()) as { id: string } }));
  await fetch(`http://[::1]:${t.s.port}/api/agent/conversations/${body.id}/prompt`, {
    method: "POST",
    headers: { cookie: t.cookie, "content-type": "application/json" },
    body: JSON.stringify({ text: "go" }),
  });
  await waitFor(() => t!.s.context.proposals.pending().length === 1, 10_000);
});

test("the agent can reach /mcp while its session is starting", async () => {
  process.env.FAKE_AGENT_MCP_ON_START = "1";
  const t = await withAgent([[{ mcp: "schema" }]], { "tasks/a.yaml": "title: A\n" });
  const started = await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } });
  expect(started.status).toBe(201);
  const ev = await eventsOf(t, started.body.id);
  await t.api(`/api/agent/conversations/${started.body.id}/prompt`, { method: "POST", body: { text: "x" } });
  await waitFor(() => ev.got.some((e) => e.type === "text" && /tasks/.test(e.text)));
  await ev.close();
});

test("the conversation list is newest first with title and status", async () => {
  const t = await withAgent([[{ say: "ok" }]], { "tasks/a.yaml": "title: A\n" });
  const a = (await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } })).body.id;
  const b = (await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } })).body.id;
  await t.api(`/api/agent/conversations/${a}/prompt`, { method: "POST", body: { text: "一覧して" } });
  const host = t.s.context.agent!;
  await waitForAsync(async () => !host.get(a)!.busy && host.get(a)!.events.length > 3, 10_000);
  await host.stop(b);
  const { status, body } = await t.api("/api/agent/conversations");
  expect(status).toBe(200);
  expect(body).toEqual({
    conversations: [
      { id: a, agent: "test", title: "一覧して", updatedAt: expect.any(String), status: "active" },
      { id: b, agent: "test", title: "", updatedAt: expect.any(String), status: "dormant" },
    ],
  });
});

test("events of a dormant conversation replay its history and stream the resumed turn", async () => {
  const t = await withAgent([[{ say: "one" }], [{ echoHistory: true }]], { "tasks/a.yaml": "title: A\n" });
  const { body } = await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } });
  await t.api(`/api/agent/conversations/${body.id}/prompt`, { method: "POST", body: { text: "first" } });
  const host = t.s.context.agent!;
  await waitForAsync(async () => host.get(body.id)!.events.some((e) => e.type === "busy" && !e.busy), 10_000);
  await host.stop(body.id);
  const ev = await eventsOf(t, body.id);
  await waitFor(() => ev.got.some((e) => e.type === "text" && e.text === "one"));
  expect(ev.got[0]).toEqual({ type: "user", text: "first" });
  await t.api(`/api/agent/conversations/${body.id}/prompt`, { method: "POST", body: { text: "second" } });
  await waitFor(() => ev.got.some((e) => e.type === "text" && e.text.endsWith("first")), 10_000);
  await ev.close();
});

test("/mcp refuses a conversation's old token once it has resumed with a new one", async () => {
  const t = await withAgent([[{ say: "one" }], [{ say: "two" }]], { "tasks/a.yaml": "title: A\n" });
  const { body } = await t.api("/api/agent/conversations", { method: "POST", body: { agent: "test" } });
  const host = t.s.context.agent!;
  const c = host.get(body.id)!;
  const old = c.token;
  const call = (token: string) =>
    fetch(`${t.base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }).then((r) => r.status);
  expect(await call(old)).toBe(200);
  await host.stop(body.id);
  expect(await call(old)).toBe(401);
  await t.api(`/api/agent/conversations/${body.id}/prompt`, { method: "POST", body: { text: "again" } });
  await waitForAsync(async () => c.status === "active" && !c.busy, 10_000);
  expect(await call(old)).toBe(401);
  expect(await call(c.token)).toBe(200);
});
