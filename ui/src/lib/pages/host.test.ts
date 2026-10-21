import { expect, test, vi } from "vitest";
import { ApiError } from "../api";
import type { Meta, PageMeta } from "../types";
import { type HostDeps, PageHost, READ_ONLY } from "./host";
import { memoryLocation } from "./location";

const meta = {
  tables: [{ name: "tasks" }, { name: "people" }],
  views: [{ name: "tasks__tags", table: "tasks" }],
} as unknown as Meta;
const board: PageMeta = {
  name: "board",
  title: "Board",
  path: ".pages/b.html",
  access: { tasks: "write", people: "read", tasks__tags: "read" },
  sql: false,
  network: [],
  ai: null,
};

function setup(
  page: PageMeta = board,
  readOnly = false,
  ai: HostDeps["ai"] = () => ({ provider: "anthropic", models: ["m1", "m2"] }),
) {
  const posted: Array<Record<string, any>> = [];
  const frame = { postMessage: (m: Record<string, any>) => posted.push(m) } as unknown as Window;
  const deps: HostDeps = {
    api: {
      rows: vi.fn(async () => ({ rows: [], total: 0 })),
      record: vi.fn(async () => ({ row: { id: "a" }, file: "tasks/a.yaml", yaml: "id: a\n" })),
      create: vi.fn(async () => ({ key: "n" })),
      update: vi.fn(async () => ({ ok: true as const })),
      remove: vi.fn(async () => ({ ok: true as const })),
      pageSql: vi.fn(async () => ({ columns: ["x"], rows: [{ x: 1 }], truncated: false, ms: 0 })),
      pageAi: vi.fn(async () => ({ text: "answer" })),
      pageAiStream: vi.fn((_page: string, _body: unknown, _signal: AbortSignal): AsyncIterable<string> => {
        throw new Error("not set");
      }),
    },
    ai,
    readOnly,
    open: vi.fn(),
    blocked: vi.fn(),
    escape: vi.fn(),
    click: vi.fn(),
    theme: () => "dark",
    location: memoryLocation(),
  };
  const host = new PageHost(
    () => frame,
    () => page,
    () => meta,
    deps,
  );
  let id = 0;
  const ask = async (method: string, ...args: unknown[]) => {
    const mine = ++id;
    host.handle({ source: frame, data: { yamlite: 1, id: mine, method, args } } as MessageEvent);
    const answered = (m: Record<string, any>) => m.id === mine && "ok" in m;
    await vi.waitFor(() => expect(posted.some(answered)).toBe(true));
    return posted.find(answered) as Record<string, any>;
  };
  return { host, frame, posted, deps, ask };
}

test("messages from other windows and foreign shapes are ignored", async () => {
  const { host, posted } = setup();
  host.handle({ source: {}, data: { yamlite: 1, id: 1, method: "hello", args: [] } } as MessageEvent);
  host.handle({ source: null, data: "hello" } as MessageEvent);
  await new Promise((r) => setTimeout(r, 10));
  expect(posted).toEqual([]);
});

test("hello describes the page", async () => {
  expect((await setup().ask("hello")).value).toEqual({
    page: "board",
    title: "Board",
    access: board.access,
    sql: false,
    network: [],
    readOnly: false,
    ai: null,
  });
  expect((await setup(board, true).ask("hello")).value.readOnly).toBe(true);
  expect((await setup({ ...board, access: { people: "read" } }).ask("hello")).value.readOnly).toBe(true);
});

test("rows go to the api with defaults, only for names in access", async () => {
  const { ask, deps } = setup();
  expect(await ask("rows", "tasks__tags", { sort: "idx:desc" })).toMatchObject({ ok: true });
  expect(deps.api.rows).toHaveBeenCalledWith("tasks__tags", {
    limit: 100,
    offset: 0,
    sort: "idx:desc",
    filters: [],
    search: undefined,
  });
  expect((await ask("rows", "secret")).error).toEqual({
    status: 403,
    message: "secret is not in this page's access",
    extra: {},
  });
});

test("writes need write access", async () => {
  const { ask, deps } = setup();
  expect((await ask("update", "people", "p", { name: "x" }, { name: "y" })).error.message).toBe(
    "people is read-only for this page",
  );
  expect(await ask("update", "tasks", "a", { status: "done" }, { status: "todo" })).toMatchObject({ ok: true });
  expect(deps.api.update).toHaveBeenCalledWith("tasks", "a", { status: "done" }, { status: "todo" });
  expect(await ask("create", "tasks", "n", { title: "N" })).toMatchObject({ ok: true, value: { key: "n" } });
  expect(await ask("remove", "tasks", "a")).toMatchObject({ ok: true });
});

test("a read-only deployment refuses writes even with write access", async () => {
  const { ask, deps } = setup(board, true);
  expect((await ask("create", "tasks", "n", {})).error).toMatchObject({ status: 403, message: READ_ONLY });
  expect(deps.api.create).not.toHaveBeenCalled();
});

test("a conflict comes back with its current and stale fields", async () => {
  const { ask, deps } = setup();
  vi.mocked(deps.api.update).mockRejectedValueOnce(
    new ApiError(409, "changed since it was loaded: status", {
      error: "changed since it was loaded: status",
      current: { status: "doing" },
      stale: ["status"],
    }),
  );
  expect((await ask("update", "tasks", "a", { status: "done" }, { status: "todo" })).error).toEqual({
    status: 409,
    message: "changed since it was loaded: status",
    extra: { current: { status: "doing" }, stale: ["status"] },
  });
});

test("get and open take tables, not views", async () => {
  const { ask, deps } = setup();
  expect((await ask("get", "tasks", "a")).value).toEqual({ row: { id: "a" }, file: "tasks/a.yaml" });
  expect((await ask("open", "tasks__tags", "a")).error).toMatchObject({
    status: 400,
    message: "tasks__tags is a view; its rows are not records",
  });
  expect(await ask("open", "tasks", "a")).toMatchObject({ ok: true, value: null });
  expect(deps.open).toHaveBeenCalledWith("tasks", "a");
});

test("sql needs the sql permission", async () => {
  expect((await setup().ask("sql", "select 1")).error).toMatchObject({
    status: 403,
    message: "page board may not run SQL",
  });
  const withSql = setup({ ...board, sql: true });
  expect(await withSql.ask("sql", "select 1")).toMatchObject({ ok: true });
  expect(withSql.deps.api.pageSql).toHaveBeenCalledWith("board", "select 1");
});

test("bad arguments and unknown methods are 400", async () => {
  const { ask } = setup();
  expect((await ask("get", "tasks", 1)).error).toMatchObject({
    status: 400,
    message: "key must be a non-empty string",
  });
  expect((await ask("update", "tasks", "a", [1], {})).error).toMatchObject({
    status: 400,
    message: "values must be an object",
  });
  expect((await ask("drop", "tasks")).error).toMatchObject({ status: 400, message: "unknown method: drop" });
});

test("a change to a table reaches the page with its views, if the page reads them", () => {
  const { host, posted } = setup();
  host.notify(["tasks"]);
  host.notify(["secret"]);
  expect(posted).toEqual([{ yamlite: 1, event: "change", data: { tables: ["tasks", "tasks__tags"] } }]);
});

test("blocked urls are forwarded without an answer", () => {
  const { host, frame, deps, posted } = setup();
  host.handle({ source: frame, data: { yamlite: 1, method: "blocked", args: ["https://x.test/"] } } as MessageEvent);
  expect(deps.blocked).toHaveBeenCalledWith("https://x.test/");
  expect(posted).toEqual([]);
});

test("nothing is posted after dispose", async () => {
  const { host, frame, posted } = setup();
  host.dispose();
  host.handle({ source: frame, data: { yamlite: 1, id: 1, method: "hello", args: [] } } as MessageEvent);
  host.notify(["tasks"]);
  await new Promise((r) => setTimeout(r, 10));
  expect(posted).toEqual([]);
});

test("theme posts a theme event to the frame", () => {
  const { host, posted } = setup();
  host.theme("dark");
  expect(posted).toEqual([{ yamlite: 1, event: "theme", data: { theme: "dark" } }]);
});

test("answering hello is followed by the current theme", async () => {
  const { ask, posted } = setup();
  const answer = await ask("hello");
  const at = posted.indexOf(answer);
  expect(posted[at + 1]).toEqual({ yamlite: 1, event: "theme", data: { theme: "dark" } });
});

test("escape and click from the frame are passed on without an answer", () => {
  const { host, frame, posted, deps } = setup();
  for (const method of ["escape", "click"]) {
    host.handle({ source: frame, data: { yamlite: 1, method, args: [] } } as MessageEvent);
    host.handle({ source: {}, data: { yamlite: 1, method, args: [] } } as MessageEvent);
  }
  expect(deps.escape).toHaveBeenCalledTimes(1);
  expect(deps.click).toHaveBeenCalledTimes(1);
  expect(posted).toHaveLength(0);
});

test("the page's moves are kept without an answer, and a path that leaves the page is dropped", () => {
  const { host, frame, posted, deps } = setup();
  const send = (method: string, args: unknown[]) =>
    host.handle({ source: frame, data: { yamlite: 1, method, args } } as MessageEvent);
  send("navigate", ["/orders/42", false]);
  send("navigate", ["https://example.com/", false]);
  send("navigate", ["/orders/43", true]);
  expect(deps.location.path).toBe("/orders/43");
  send("go", ["-1"]);
  expect(deps.location.path).toBe("/orders/43");
  send("go", [-1]);
  expect(deps.location.path).toBe("/");
  expect(posted).toEqual([{ yamlite: 1, event: "location", data: { path: "/", state: null } }]);
});

test("the state a page moves with is kept with the place and handed back when the page returns to it", () => {
  const { host, frame, posted, deps } = setup();
  const send = (method: string, args: unknown[]) =>
    host.handle({ source: frame, data: { yamlite: 1, method, args } } as MessageEvent);
  send("navigate", ["/a", false, { tab: 2 }]);
  expect(deps.location.state).toEqual({ tab: 2 });
  send("navigate", ["/b", false]);
  send("go", [-1]);
  expect(posted).toEqual([{ yamlite: 1, event: "location", data: { path: "/a", state: { tab: 2 } } }]);
});

test("a move from outside the page is told to it until the host is disposed", () => {
  const { host, posted, deps } = setup();
  deps.location.navigate("/a", false);
  deps.location.go(-1);
  host.dispose();
  deps.location.go(1);
  expect(posted).toEqual([{ yamlite: 1, event: "location", data: { path: "/", state: null } }]);
});

const writer = { ...board, ai: { maxOutputTokens: 1024 } };

// a stream the test feeds by hand, ending when its signal aborts unless it is deaf to it, as a buffering transport is
function controlled(deaf = false) {
  const queue: Array<IteratorResult<string>> = [];
  let wake: (() => void) | null = null;
  let signal: AbortSignal | undefined;
  const push = (r: IteratorResult<string>) => {
    queue.push(r);
    wake?.();
  };
  const stream = (_page: string, _body: unknown, s: AbortSignal): AsyncIterable<string> => {
    signal = s;
    s.addEventListener("abort", () => wake?.());
    return {
      [Symbol.asyncIterator]: () => ({
        async next() {
          for (;;) {
            if (signal?.aborted && !deaf) throw new DOMException("aborted", "AbortError");
            const r = queue.shift();
            if (r) return r;
            await new Promise<void>((resolve) => (wake = resolve));
          }
        },
      }),
    };
  };
  return {
    stream,
    delta: (text: string) => push({ value: text, done: false }),
    end: () => push({ value: undefined, done: true }),
    signal: () => signal,
  };
}

test("hello offers the host's provider only to a page that declares ai, on a host with a key", async () => {
  expect((await setup().ask("hello")).value.ai).toBeNull();
  expect((await setup(writer, false, () => null).ask("hello")).value.ai).toBeNull();
  expect((await setup(writer).ask("hello")).value.ai).toEqual({ provider: "anthropic", models: ["m1", "m2"] });
});

test("ai needs the page's ai, and goes to the api with the page's name", async () => {
  const denied = setup();
  expect((await denied.ask("ai", { prompt: "hi" })).error).toEqual({
    status: 403,
    message: "page board may not use AI",
    extra: {},
  });
  expect((await denied.ask("ai-stream", { prompt: "hi" })).error).toMatchObject({ status: 403 });
  expect(denied.deps.api.pageAi).not.toHaveBeenCalled();
  expect(denied.deps.api.pageAiStream).not.toHaveBeenCalled();
  const { ask, deps } = setup(writer);
  expect(await ask("ai", { prompt: "hi" })).toMatchObject({ ok: true, value: { text: "answer" } });
  expect(deps.api.pageAi).toHaveBeenCalledWith("board", { prompt: "hi" }, expect.any(AbortSignal));
  expect((await ask("ai", "hi")).error).toMatchObject({ status: 400, message: "input must be an object" });
});

test("an ai error keeps its code, provider and retryAfter", async () => {
  const { ask, deps } = setup(writer);
  vi.mocked(deps.api.pageAi).mockRejectedValueOnce(
    new ApiError(429, "slow down", { error: "slow down", provider: "anthropic", retryAfter: 3 }),
  );
  expect((await ask("ai", { prompt: "hi" })).error).toEqual({
    status: 429,
    message: "slow down",
    extra: { provider: "anthropic", retryAfter: 3 },
  });
});

test("a stream's deltas reach the page in order, then its answer", async () => {
  const { ask, deps, posted } = setup(writer);
  const c = controlled();
  vi.mocked(deps.api.pageAiStream).mockImplementation(c.stream);
  const answer = ask("ai-stream", { prompt: "hi" });
  await vi.waitFor(() => expect(c.signal()).toBeDefined());
  c.delta("Hel");
  c.delta("lo");
  c.end();
  const reply = await answer;
  expect(reply).toEqual({ yamlite: 1, id: 1, ok: true, value: null });
  expect(posted).toEqual([
    { yamlite: 1, event: "ai-delta", id: 1, data: { text: "Hel" } },
    { yamlite: 1, event: "ai-delta", id: 1, data: { text: "lo" } },
    reply,
  ]);
  expect(deps.api.pageAiStream).toHaveBeenCalledWith("board", { prompt: "hi" }, expect.any(AbortSignal));
});

test("ai-cancel aborts that stream", async () => {
  const { host, frame, deps } = setup(writer);
  const c = controlled();
  vi.mocked(deps.api.pageAiStream).mockImplementation(c.stream);
  host.handle({
    source: frame,
    data: { yamlite: 1, id: 7, method: "ai-stream", args: [{ prompt: "hi" }] },
  } as MessageEvent);
  await vi.waitFor(() => expect(c.signal()).toBeDefined());
  host.handle({ source: frame, data: { yamlite: 1, method: "ai-cancel", args: [8] } } as MessageEvent);
  expect(c.signal()?.aborted).toBe(false);
  host.handle({ source: frame, data: { yamlite: 1, method: "ai-cancel", args: [7] } } as MessageEvent);
  expect(c.signal()?.aborted).toBe(true);
});

test("a cancelled stream that keeps going is not passed on", async () => {
  const { host, frame, deps, posted } = setup(writer);
  const c = controlled(true);
  vi.mocked(deps.api.pageAiStream).mockImplementation(c.stream);
  host.handle({
    source: frame,
    data: { yamlite: 1, id: 7, method: "ai-stream", args: [{ prompt: "hi" }] },
  } as MessageEvent);
  await vi.waitFor(() => expect(c.signal()).toBeDefined());
  host.handle({ source: frame, data: { yamlite: 1, method: "ai-cancel", args: [7] } } as MessageEvent);
  c.delta("late");
  c.end();
  await vi.waitFor(() => expect(posted.some((m) => m.id === 7 && "ok" in m)).toBe(true));
  expect(posted.filter((m) => m.event === "ai-delta")).toEqual([]);
});

test("dispose aborts open streams, and nothing more reaches the page", async () => {
  const { host, frame, deps, posted } = setup(writer);
  const c = controlled(true);
  vi.mocked(deps.api.pageAiStream).mockImplementation(c.stream);
  host.handle({
    source: frame,
    data: { yamlite: 1, id: 7, method: "ai-stream", args: [{ prompt: "hi" }] },
  } as MessageEvent);
  await vi.waitFor(() => expect(c.signal()).toBeDefined());
  c.delta("a");
  await vi.waitFor(() => expect(posted).toHaveLength(1));
  host.dispose();
  expect(c.signal()?.aborted).toBe(true);
  c.delta("b");
  await new Promise((r) => setTimeout(r, 10));
  expect(posted).toEqual([{ yamlite: 1, event: "ai-delta", id: 7, data: { text: "a" } }]);
});

test("dispose aborts a generate in flight, and its answer is not posted", async () => {
  const { host, frame, deps, posted } = setup(writer);
  let seen: AbortSignal | undefined;
  let finish: (v: { text: string }) => void = () => {};
  vi.mocked(deps.api.pageAi).mockImplementation(((_p: string, _b: unknown, signal?: AbortSignal) => {
    seen = signal;
    return new Promise((resolve) => (finish = resolve));
  }) as typeof deps.api.pageAi);
  host.handle({ source: frame, data: { yamlite: 1, id: 3, method: "ai", args: [{ prompt: "hi" }] } } as MessageEvent);
  await vi.waitFor(() => expect(seen).toBeDefined());
  expect(seen?.aborted).toBe(false);
  host.dispose();
  expect(seen?.aborted).toBe(true);
  finish({ text: "late" });
  await new Promise((r) => setTimeout(r, 10));
  expect(posted).toEqual([]);
});
