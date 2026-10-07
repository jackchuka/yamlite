import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { AgentInfo } from "../../src/agent/detect.ts";
import { type AgentEvent, AgentHost, AgentStartError, type HostOptions } from "../../src/agent/host.ts";
import { tmpRoot } from "../helpers.ts";
import { waitForAsync } from "../serve/helpers.ts";

// each test spawns agent processes; under a full parallel run that takes longer than the default 5s
vi.setConfig({ testTimeout: 30_000 });

const FAKE = resolve(import.meta.dirname, "../fixtures/fake-agent.mjs");
let host: AgentHost | undefined;
const extra: AgentHost[] = [];
afterEach(async () => {
  await host?.close();
  await Promise.all(extra.splice(0).map((h) => h.close()));
  host = undefined;
  delete process.env.FAKE_AGENT_SCENARIO;
  delete process.env.FAKE_AGENT_LOGIN;
  delete process.env.FAKE_AGENT_MODE;
  delete process.env.FAKE_AGENT_MODE_STUCK;
  delete process.env.FAKE_AGENT_PIDFILE;
  delete process.env.FAKE_AGENT_STATE_DIR;
  delete process.env.FAKE_AGENT_RESUME;
  delete process.env.FAKE_AGENT_RESUME_FAIL;
  delete process.env.FAKE_AGENT_EXIT_AFTER_RESUME;
  delete process.env.FAKE_AGENT_SLOW_INIT;
});

function setup(
  turns: unknown[][],
  feedback: string[] = [],
  info: Partial<AgentInfo> = {},
  options: Partial<HostOptions> = {},
) {
  const dir = tmpRoot();
  const scenario = join(dir, "scenario.json");
  writeFileSync(scenario, JSON.stringify(turns));
  process.env.FAKE_AGENT_SCENARIO = scenario;
  process.env.FAKE_AGENT_STATE_DIR = dir;
  const agent: AgentInfo = {
    id: "test",
    name: "Test agent",
    command: process.execPath,
    args: [FAKE],
    login: "login",
    ...info,
  };
  host = new AgentHost({
    root: dir,
    agents: [agent],
    mcpUrl: () => "http://127.0.0.1:1/mcp",
    feedback: () => feedback.splice(0),
    ...options,
  });
  return { dir, host };
}

const texts = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "text" ? [e.text] : []));
const idle = (c: { busy: boolean }) => waitForAsync(async () => !c.busy, 10_000);

test("a turn streams text and ends idle", async () => {
  const { host } = setup([[{ say: "hello " }, { say: "there" }]]);
  const c = await host.start("test");
  host.prompt(c.id, "hi");
  await idle(c);
  expect(c.events[0]).toEqual({ type: "user", text: "hi" });
  expect(texts(c.events).join("")).toBe("hello there");
  expect(c.events.filter((e) => e.type === "busy")).toEqual([
    { type: "busy", busy: true },
    { type: "busy", busy: false },
  ]);
});

test("a shell request is denied without asking, and shown", async () => {
  const dir = tmpRoot();
  const marker = join(dir, "ran.txt");
  const { host } = setup([[{ ask: { title: "Bash", kind: "execute" }, marker }]]);
  const c = await host.start("test");
  host.prompt(c.id, "run it");
  await idle(c);
  expect(existsSync(marker)).toBe(false);
  expect(texts(c.events)).toContain("denied");
  expect(c.events).toContainEqual(expect.objectContaining({ type: "tool", title: "Bash", status: "denied" }));
});

test("a yamlite tool request with no title is allowed from the remembered tool_call title", async () => {
  const { host } = setup([
    [
      { update: { sessionUpdate: "tool_call", toolCallId: "x", title: "mcp.yamlite.query", kind: "other" } },
      { ask: { kind: "execute" }, toolCallId: "x" },
    ],
  ]);
  const c = await host.start("test");
  host.prompt(c.id, "go");
  await idle(c);
  expect(texts(c.events)).toEqual(["allowed"]);
});

test("a titleless request with no prior update is denied", async () => {
  const { host } = setup([[{ ask: { kind: "execute" }, toolCallId: "y" }]]);
  const c = await host.start("test");
  host.prompt(c.id, "go");
  await idle(c);
  expect(texts(c.events)).toEqual(["denied"]);
  expect(c.events).toContainEqual(expect.objectContaining({ type: "tool", id: "y", status: "denied" }));
});

test("a remembered title never overrides the request's own title", async () => {
  const { host } = setup([
    [
      { update: { sessionUpdate: "tool_call", toolCallId: "x", title: "mcp.yamlite.query", kind: "other" } },
      { ask: { title: "Bash", kind: "execute" }, toolCallId: "x" },
    ],
  ]);
  const c = await host.start("test");
  host.prompt(c.id, "go");
  await idle(c);
  expect(texts(c.events)).toEqual(["denied"]);
});

test("a malformed request is denied rather than crashing", async () => {
  const { host } = setup([[{ ask: { kind: "read", locations: [{ path: 5 }] } }]]);
  const c = await host.start("test");
  host.prompt(c.id, "go");
  await idle(c);
  expect(texts(c.events)).toEqual(["denied"]);
});

test("feedback lines and the preamble go before the first prompt; feedback only after", async () => {
  const feedback = ["The user applied proposal p_1."];
  const { host } = setup([[{ echo: true }], [{ echo: true }]], feedback);
  const c = await host.start("test");
  host.prompt(c.id, "first");
  await idle(c);
  expect(texts(c.events)[0]).toMatch(/yamlite[\s\S]*The user applied proposal p_1\.[\s\S]*---\nfirst$/);
  feedback.push("Proposal p_2 failed.");
  host.prompt(c.id, "second");
  await idle(c);
  expect(texts(c.events)[1]).toBe("Proposal p_2 failed.\n---\nsecond");
});

test("a second prompt while busy is refused; cancel ends the turn", async () => {
  const { host } = setup([[{ wait: 10_000 }]]);
  const c = await host.start("test");
  host.prompt(c.id, "slow");
  expect(() => host.prompt(c.id, "again")).toThrow(/busy/);
  await host.cancel(c.id);
  await idle(c);
});

test("a crash leaves the conversation dormant and not busy; the next prompt resumes it", async () => {
  const { host } = setup([[{ crash: true }], [{ echoHistory: true }]]);
  const c = await host.start("test");
  host.prompt(c.id, "die");
  await waitForAsync(async () => c.status === "dormant", 10_000);
  expect(c.busy).toBe(false);
  expect(c.events.at(-1)).toMatchObject({
    type: "error",
    message: "エージェントが停止しました。次のメッセージで会話を再開します。",
  });
  host.prompt(c.id, "again");
  await waitForAsync(async () => texts(c.events).includes("die"), 10_000);
  expect(c.status).toBe("active");
});

test("login and spawn failures are typed", async () => {
  const { host } = setup([[]]);
  process.env.FAKE_AGENT_LOGIN = "1";
  await expect(host.start("test")).rejects.toMatchObject({ code: "login" });
  delete process.env.FAKE_AGENT_LOGIN;
  const broken = new AgentHost({
    root: tmpRoot(),
    agents: [{ id: "x", name: "X", command: "/nope/missing", args: [], login: "x" }],
    mcpUrl: () => "",
    feedback: () => [],
  });
  extra.push(broken);
  await expect(broken.start("x")).rejects.toBeInstanceOf(AgentStartError);
  await expect(broken.start("x")).rejects.toMatchObject({ code: "spawn" });
});

test("an unknown agent id is a 404, and a configured mode is set", async () => {
  const { host } = setup([[{ mode: true }]], [], { mode: "plan" });
  await expect(host.start("nope")).rejects.toMatchObject({ status: 404 });
  const c = await host.start("test");
  host.prompt(c.id, "go");
  await idle(c);
  expect(texts(c.events)).toEqual(["mode:plan"]);
});

test("close during a pending start kills the child and rejects the start", async () => {
  process.env.FAKE_AGENT_SLOW_INIT = "3000";
  const { dir, host } = setup([[]]);
  const pidfile = join(dir, "pid");
  process.env.FAKE_AGENT_PIDFILE = pidfile;
  try {
    const starting = host.start("test").then(
      () => undefined,
      (e: unknown) => e,
    );
    await waitForAsync(async () => existsSync(pidfile));
    const pid = Number(readFileSync(pidfile, "utf8"));
    await host.close();
    expect(await starting).toBeInstanceOf(AgentStartError);
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(host.start("test")).rejects.toThrow(/shutting down/);
  } finally {
    delete process.env.FAKE_AGENT_PIDFILE;
    delete process.env.FAKE_AGENT_SLOW_INIT;
  }
});

test("the agent's session meta goes to session/new", async () => {
  const sessionMeta = { claudeCode: { options: { settingSources: [], disallowedTools: ["Bash"] } } };
  const { host } = setup([[{ meta: true }]], [], { sessionMeta });
  const c = await host.start("test");
  host.prompt(c.id, "go");
  await idle(c);
  expect(JSON.parse(texts(c.events)[0] as string)).toEqual(sessionMeta);
});

test("a session that starts in another mode is switched to the expected one", async () => {
  process.env.FAKE_AGENT_MODE = "acceptEdits";
  const { host } = setup([[{ mode: true }]], [], { mode: "default" });
  const c = await host.start("test");
  host.prompt(c.id, "go");
  await idle(c);
  expect(texts(c.events)).toEqual(["mode:default"]);
});

test("start fails and the child is killed when the mode does not take", async () => {
  process.env.FAKE_AGENT_MODE = "acceptEdits";
  process.env.FAKE_AGENT_MODE_STUCK = "1";
  const { dir, host } = setup([[]], [], { mode: "default" });
  const pidfile = join(dir, "pid");
  process.env.FAKE_AGENT_PIDFILE = pidfile;
  const err = await host.start("test").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AgentStartError);
  expect(err).toMatchObject({ code: "protocol", message: expect.stringMatching(/acceptEdits/) });
  const pid = Number(readFileSync(pidfile, "utf8"));
  await waitForAsync(async () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const gone = async (child: { exitCode: number | null; signalCode: NodeJS.Signals | null }) =>
  waitForAsync(async () => child.exitCode !== null || child.signalCode !== null, 5000);

test("a conversation nobody watches goes dormant after the idle time: process gone, history kept", async () => {
  const { host } = setup([[{ say: "hi" }]], [], {}, { idleMs: 200 });
  const c = await host.start("test");
  const child = c.child!;
  host.prompt(c.id, "hello");
  await idle(c);
  await waitForAsync(async () => c.status === "dormant", 5000);
  await gone(child);
  expect(c.child).toBeNull();
  expect(host.get(c.id)).toBe(c);
  expect(texts(c.events)).toEqual(["hi"]);
  expect(c.events.some((e) => e.type === "closed" || e.type === "error")).toBe(false);
});

test("a watched conversation stays active; it goes dormant once the last watcher leaves", async () => {
  const { host } = setup([[{ say: "hi" }]], [], {}, { idleMs: 200 });
  const c = await host.start("test");
  const off = c.subscribe(() => {});
  expect(c.subscribers).toBe(1);
  await sleep(500);
  expect(c.status).toBe("active");
  off();
  expect(c.subscribers).toBe(0);
  await waitForAsync(async () => c.status === "dormant", 5000);
});

test("a busy conversation is not stopped while its turn runs", async () => {
  const { host } = setup([[{ wait: 700 }, { say: "done" }]], [], {}, { idleMs: 200 });
  const c = await host.start("test");
  host.prompt(c.id, "slow");
  await sleep(500);
  expect(c.status).toBe("active");
  await waitForAsync(async () => texts(c.events).includes("done"), 5000);
  await waitForAsync(async () => c.status === "dormant", 5000);
});

async function dormant(turns: unknown[][], info: Partial<AgentInfo> = {}, feedback: string[] = []) {
  const s = setup(turns, feedback, info, { idleMs: 100 });
  const c = await s.host.start("test");
  s.host.prompt(c.id, "first");
  await idle(c);
  await waitForAsync(async () => c.status === "dormant", 5000);
  return { ...s, c };
}

test("a prompt on a dormant conversation resumes the same session; the agent sees earlier prompts", async () => {
  const feedback: string[] = [];
  const { host, c } = await dormant([[{ say: "one" }], [{ echoHistory: true }, { echo: true }]], {}, feedback);
  const session = c.sessionId;
  const token = c.token;
  feedback.push("The user applied proposal p_1.");
  host.prompt(c.id, "second");
  expect(c.busy).toBe(true);
  expect(c.events.at(-1)).toEqual({ type: "busy", busy: true });
  await waitForAsync(async () => texts(c.events).length === 3, 10_000);
  await idle(c);
  expect(c.sessionId).toBe(session);
  expect(c.token).not.toBe(token);
  expect(c.status).toBe("active");
  const [, history, echoed] = texts(c.events);
  expect(history).toMatch(/first$/);
  // feedback goes along; the preamble is not sent again
  expect(echoed).toBe("The user applied proposal p_1.\n---\nsecond");
});

test("resume uses session/load when session/resume is not advertised, without repeating history", async () => {
  process.env.FAKE_AGENT_RESUME = "load";
  const { host, c } = await dormant([[{ say: "one" }], [{ echoHistory: true }]]);
  const before = c.events.length;
  host.prompt(c.id, "second");
  await waitForAsync(async () => texts(c.events).length === 2, 10_000);
  await idle(c);
  expect(c.events.slice(before)).toEqual([
    { type: "user", text: "second" },
    { type: "busy", busy: true },
    { type: "text", text: expect.stringMatching(/first$/) },
    { type: "busy", busy: false },
  ]);
});

test("an agent that can neither resume nor load fails the conversation with a typed error", async () => {
  process.env.FAKE_AGENT_RESUME = "none";
  const { host, c } = await dormant([[{ say: "one" }]]);
  host.prompt(c.id, "second");
  await waitForAsync(async () => c.status === "failed", 10_000);
  expect(c.busy).toBe(false);
  expect(c.child).toBeNull();
  expect(c.events).toContainEqual(
    expect.objectContaining({ type: "error", code: "resume_failed", message: expect.any(String) }),
  );
  expect(() => host.prompt(c.id, "third")).toThrow(/resumed/);
});

test("a resume the agent refuses fails the conversation and kills the process", async () => {
  const { dir, host, c } = await dormant([[{ say: "one" }]]);
  process.env.FAKE_AGENT_RESUME_FAIL = "1";
  const pidfile = join(dir, "pid2");
  process.env.FAKE_AGENT_PIDFILE = pidfile;
  host.prompt(c.id, "second");
  await waitForAsync(async () => c.status === "failed", 10_000);
  expect(c.events.at(-2)).toMatchObject({ type: "error", code: "resume_failed" });
  expect((c.events.at(-2) as { message: string }).message).not.toMatch(/STDERR-NOISE/);
  expect(c.events.at(-1)).toEqual({ type: "busy", busy: false });
  const pid = Number(readFileSync(pidfile, "utf8"));
  await waitForAsync(async () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });
});

test("a resumed session that does not take the mode is killed and failed", async () => {
  process.env.FAKE_AGENT_MODE = "acceptEdits";
  const { host, c } = await dormant([[{ mode: true }]], { mode: "default" });
  expect(texts(c.events)).toEqual(["mode:default"]);
  process.env.FAKE_AGENT_MODE_STUCK = "1";
  host.prompt(c.id, "second");
  await waitForAsync(async () => c.status === "failed", 10_000);
  expect(c.events).toContainEqual(
    expect.objectContaining({ type: "error", code: "resume_failed", message: expect.stringMatching(/acceptEdits/) }),
  );
});

test("a resumed session gets the same session meta and mode", async () => {
  const sessionMeta = { claudeCode: { options: { settingSources: [] } } };
  process.env.FAKE_AGENT_MODE = "acceptEdits";
  const { host, c } = await dormant([[{ say: "one" }], [{ meta: true }, { mode: true }]], {
    mode: "default",
    sessionMeta,
  });
  host.prompt(c.id, "second");
  await waitForAsync(async () => texts(c.events).length === 3, 10_000);
  expect(JSON.parse(texts(c.events)[1] as string)).toEqual(sessionMeta);
  expect(texts(c.events)[2]).toBe("mode:default");
});

test("byToken finds only conversations with a running agent", async () => {
  const { host, c } = await dormant([[{ say: "one" }]]);
  expect(host.byToken(c.token)).toBeUndefined();
  const live = await host.start("test");
  expect(host.byToken(live.token)).toBe(live);
});

test("title and list: newest first, with status", async () => {
  const { host } = setup([[{ say: "ok" }]]);
  const a = await host.start("test");
  host.prompt(a.id, "  来週の   タスクを\n一覧して、締め切り順に並べて、担当者ごとにまとめてください  ");
  await idle(a);
  const b = await host.start("test");
  expect(a.title).toBe("来週の タスクを 一覧して、締め切り順に並べて、担当者ごとに…");
  expect(host.list().map((x) => x.id)).toEqual([b.id, a.id]);
  host.prompt(a.id, "more");
  await idle(a);
  expect(host.list()).toEqual([
    { id: a.id, agent: "test", title: a.title, updatedAt: expect.any(String), status: "active" },
    { id: b.id, agent: "test", title: "", updatedAt: expect.any(String), status: "active" },
  ]);
});

test("the oldest dormant or failed conversation is evicted past the limit; active ones never are", async () => {
  const { host } = setup([[{ say: "ok" }]], [], {}, { maxConversations: 3 });
  const a = await host.start("test");
  const b = await host.start("test");
  const c = await host.start("test");
  const d = await host.start("test");
  expect(host.list()).toHaveLength(4);
  await host.stop(b.id);
  await host.stop(c.id);
  const e = await host.start("test");
  expect(host.get(b.id)).toBeUndefined();
  expect(host.get(c.id)).toBeUndefined();
  expect(host.list().map((x) => x.id)).toEqual([e.id, d.id, a.id]);
});

const stopped = (pid: number) =>
  waitForAsync(async () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });

test("each launch gets a fresh token; the old one stops working after a resume", async () => {
  const { host, c } = await dormant([[{ token: true }]]);
  const old = c.token;
  expect(texts(c.events)).toEqual([`Bearer ${old}`]);
  host.prompt(c.id, "second");
  await waitForAsync(async () => texts(c.events).length === 2, 10_000);
  expect(c.token).not.toBe(old);
  expect(texts(c.events)[1]).toBe(`Bearer ${c.token}`);
  expect(host.byToken(old)).toBeUndefined();
  expect(host.byToken(c.token)).toBe(c);
});

test("a resumed agent does not inherit tool titles remembered before", async () => {
  const { host, c } = await dormant([
    [{ update: { sessionUpdate: "tool_call", toolCallId: "x", title: "mcp.yamlite.query", kind: "other" } }],
    [{ ask: { kind: "execute" }, toolCallId: "x" }],
  ]);
  host.prompt(c.id, "second");
  await waitForAsync(async () => texts(c.events).length === 1, 10_000);
  expect(texts(c.events)).toEqual(["denied"]);
});

test("ending a conversation during a slow resume neither crashes nor leaves it active", async () => {
  const { dir, host, c } = await dormant([[{ say: "one" }], [{ say: "two" }]]);
  process.env.FAKE_AGENT_SLOW_INIT = "1500";
  const pidfile = join(dir, "pid3");
  process.env.FAKE_AGENT_PIDFILE = pidfile;
  host.prompt(c.id, "second");
  await waitForAsync(async () => existsSync(pidfile));
  await host.end(c.id);
  await sleep(1800);
  expect(c.status).not.toBe("active");
  expect(c.child).toBeNull();
  expect(texts(c.events)).toEqual(["one"]);
  expect(c.events.some((e) => e.type === "error")).toBe(false);
  await stopped(Number(readFileSync(pidfile, "utf8")));
});

test("stopping during a resume leaves the conversation dormant, not failed", async () => {
  const { dir, host, c } = await dormant([[{ say: "one" }], [{ say: "two" }]]);
  process.env.FAKE_AGENT_SLOW_INIT = "1500";
  const pidfile = join(dir, "pid4");
  process.env.FAKE_AGENT_PIDFILE = pidfile;
  host.prompt(c.id, "second");
  await waitForAsync(async () => existsSync(pidfile));
  await host.stop(c.id);
  await sleep(1800);
  expect(c.status).toBe("dormant");
  expect(c.busy).toBe(false);
  expect(c.events.at(-1)).toEqual({ type: "busy", busy: false });
  delete process.env.FAKE_AGENT_SLOW_INIT;
  host.prompt(c.id, "third");
  await waitForAsync(async () => texts(c.events).includes("two"), 10_000);
});

test("cancel during a resume keeps the prompt from being sent", async () => {
  const { host, c } = await dormant([[{ say: "one" }], [{ echoHistory: true }]]);
  process.env.FAKE_AGENT_SLOW_INIT = "800";
  host.prompt(c.id, "second");
  await host.cancel(c.id);
  await waitForAsync(async () => !c.busy, 10_000);
  expect(texts(c.events)).toEqual(["one"]);
  delete process.env.FAKE_AGENT_SLOW_INIT;
  host.prompt(c.id, "third");
  await waitForAsync(async () => texts(c.events).length === 2, 10_000);
  // the agent never got "second"
  expect(texts(c.events)[1]).toMatch(/^[^|]*first$/);
});

test("an agent that exits right after resuming leaves the conversation dormant", async () => {
  const { host, c } = await dormant([[{ say: "one" }], [{ say: "two" }]]);
  process.env.FAKE_AGENT_EXIT_AFTER_RESUME = "1";
  host.prompt(c.id, "second");
  await waitForAsync(async () => !c.busy && c.status !== "active", 10_000);
  expect(c.status).toBe("dormant");
  expect(c.events.some((e) => e.type === "error" && e.code === "resume_failed")).toBe(false);
});

test("eviction skips conversations someone is watching, and drops their feedback", async () => {
  const forgotten: string[] = [];
  const { host } = setup(
    [[{ say: "ok" }]],
    [],
    {},
    {
      maxConversations: 2,
      feedback: (id) => {
        forgotten.push(id);
        return [];
      },
    },
  );
  const a = await host.start("test");
  const b = await host.start("test");
  a.subscribe(() => {});
  await host.stop(a.id);
  await host.stop(b.id);
  const c = await host.start("test");
  expect(host.get(a.id)).toBe(a);
  expect(host.get(b.id)).toBeUndefined();
  expect(forgotten).toContain(b.id);
  expect(host.list().map((x) => x.id)).toEqual([c.id, a.id]);
});
