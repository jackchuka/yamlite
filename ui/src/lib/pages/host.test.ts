import { expect, test, vi } from "vitest";
import { ApiError } from "../api";
import type { Meta, PageMeta } from "../types";
import { type HostDeps, PageHost, READ_ONLY } from "./host";

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
};

function setup(page: PageMeta = board, readOnly = false) {
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
    },
    readOnly,
    open: vi.fn(),
    blocked: vi.fn(),
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
    await vi.waitFor(() => expect(posted.some((m) => m.id === mine)).toBe(true));
    return posted.find((m) => m.id === mine) as Record<string, any>;
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
    prefix: undefined,
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
