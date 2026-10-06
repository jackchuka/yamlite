import { expect, test, vi } from "vitest";
import { Chat, EMPTY_CHAT, agentApi, type AgentEvent, type Proposal, previewFor, reduceChat } from "./agent";

const run = (events: AgentEvent[]) => events.reduce(reduceChat, EMPTY_CHAT);

test("text chunks join into one agent message until something else arrives", () => {
  const s = run([
    { type: "user", text: "hi" },
    { type: "text", text: "he" },
    { type: "text", text: "llo" },
    { type: "tool", id: "t1", title: "mcp__yamlite__query", status: "in_progress", input: { sql: "SELECT 1" } },
    { type: "tool", id: "t1", status: "completed" },
    { type: "text", text: "done" },
  ]);
  expect(s.items).toEqual([
    { kind: "user", text: "hi" },
    { kind: "agent", text: "hello" },
    { kind: "tool", id: "t1", title: "mcp__yamlite__query", status: "completed", input: { sql: "SELECT 1" } },
    { kind: "agent", text: "done" },
  ]);
});

test("a proposal event replaces the same proposal in place", () => {
  const p = { id: "p1", status: "pending" } as Proposal;
  const s = run([
    { type: "proposal", proposal: p },
    { type: "text", text: "ok" },
    { type: "proposal", proposal: { ...p, status: "applied" } },
  ]);
  expect(s.items[0]).toEqual({ kind: "proposal", proposal: { ...p, status: "applied" } });
  expect(s.items).toHaveLength(2);
});

test("busy, error and closed", () => {
  expect(run([{ type: "busy", busy: true }]).busy).toBe(true);
  const s = run([
    { type: "busy", busy: true },
    { type: "error", message: "x" },
    { type: "busy", busy: false },
    { type: "closed", message: "bye" },
  ]);
  expect(s).toMatchObject({ busy: false, closed: true });
  expect(s.items).toEqual([{ kind: "error", message: "x" }]);
});

test("previewFor maps pending rows of one table by key", () => {
  const proposals = [
    {
      id: "p1",
      status: "pending",
      rows: [
        { table: "tasks", key: "a", op: "update", before: { done: false }, after: { done: true }, changed: ["done"] },
        { table: "people", key: "1", op: "delete", before: {}, after: null, changed: [] },
      ],
    },
  ] as unknown as Proposal[];
  const m = previewFor(proposals, "tasks");
  expect([...m.keys()]).toEqual(["a"]);
  expect(m.get("a")?.changed).toEqual(["done"]);
});

class FakeSource {
  readyState = 1;
  closed = false;
  handlers: Record<string, (m: unknown) => void> = {};
  addEventListener(t: string, h: (m: unknown) => void) {
    this.handlers[t] = h;
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(e: AgentEvent) {
    this.handlers.agent(new MessageEvent("agent", { data: JSON.stringify(e) }));
  }
}

async function started() {
  vi.spyOn(agentApi, "start").mockResolvedValue({ id: "c1" });
  const sources: FakeSource[] = [];
  const c = new Chat(() => {
    const s = new FakeSource();
    sources.push(s);
    return s as unknown as EventSource;
  });
  await c.start("x");
  return { src: sources[0], c, sources };
}

test("a closed event closes the stream", async () => {
  const { src, c } = await started();
  src.emit({ type: "closed" });
  expect(src.closed).toBe(true);
  expect(c.state.closed).toBe(true);
});

test("a reconnect replays into a cleared chat without duplicates", async () => {
  const { src, c } = await started();
  src.handlers.open(new Event("open"));
  src.emit({ type: "user", text: "hi" });
  src.emit({ type: "text", text: "yo" });
  src.readyState = 0;
  src.handlers.error(new Event("error"));
  expect(src.closed).toBe(false);
  src.readyState = 1;
  src.handlers.open(new Event("open"));
  src.emit({ type: "user", text: "hi" });
  src.emit({ type: "text", text: "yo" });
  expect(c.state.closed).toBe(false);
  expect(c.state.items).toEqual([
    { kind: "user", text: "hi" },
    { kind: "agent", text: "yo" },
  ]);
});

test("the browser giving up closes the chat with an error item", async () => {
  const { src, c } = await started();
  src.readyState = 2;
  src.handlers.error(new Event("error"));
  expect(src.closed).toBe(true);
  expect(c.state.closed).toBe(true);
  expect(c.state.items.at(-1)).toEqual({
    kind: "error",
    message: "The connection was lost. Start a new conversation.",
  });
});

test("a stale source and malformed frames are ignored", async () => {
  const { src, c, sources } = await started();
  src.handlers.agent(new MessageEvent("agent", { data: "{nope" }));
  expect(c.state.items).toEqual([]);
  await c.start("x");
  expect(src.closed).toBe(true);
  expect(sources).toHaveLength(2);
  src.emit({ type: "user", text: "old" });
  src.readyState = 2;
  src.handlers.error(new Event("error"));
  expect(c.state.items).toEqual([]);
  expect(c.state.closed).toBe(false);
});

test("open switches to another conversation and rebuilds its log from the replay", async () => {
  const { src, c, sources } = await started();
  src.emit({ type: "user", text: "old" });
  c.open("c2", "y");
  expect(src.closed).toBe(true);
  expect(c.id).toBe("c2");
  expect(c.agentId).toBe("y");
  expect(c.state).toEqual(EMPTY_CHAT);
  const next = sources[1] as FakeSource;
  next.emit({ type: "user", text: "earlier" });
  next.emit({ type: "text", text: "reply" });
  src.emit({ type: "user", text: "stale" });
  expect(c.state.items).toEqual([
    { kind: "user", text: "earlier" },
    { kind: "agent", text: "reply" },
  ]);
});

test("reset leaves the previous conversation running on the server", async () => {
  const { src, c } = await started();
  const fetched = vi.spyOn(globalThis, "fetch");
  await c.reset();
  expect(fetched.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  expect("end" in agentApi).toBe(false);
  expect(src.closed).toBe(true);
  expect(c.id).toBeNull();
  expect(c.state).toEqual(EMPTY_CHAT);
});

test("a resume failure marks the chat failed", () => {
  const s = run([
    { type: "user", text: "hi" },
    { type: "error", code: "resume_failed", message: "no resume" },
    { type: "busy", busy: false },
  ]);
  expect(s.failed).toBe(true);
  // the panel shows its own note; the server's reason is not put in the chat
  expect(s.items).toEqual([{ kind: "user", text: "hi" }]);
  expect(run([{ type: "error", message: "x" }]).failed).toBe(false);
});

test("start, open and reset refresh the conversation list", async () => {
  const { queryClient } = await import("./providers");
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const { c } = await started();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agent-conversations"] });
  invalidate.mockClear();
  c.open("c2", "x");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agent-conversations"] });
  invalidate.mockClear();
  await c.reset();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agent-conversations"] });
});
