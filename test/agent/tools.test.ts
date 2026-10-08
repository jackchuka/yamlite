import { afterEach, expect, test } from "vitest";
import { agentTools } from "../../src/agent/tools.ts";
import { guide } from "../../src/guide.ts";
import { type Served, startServe } from "../serve/helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const call = async (t: Served, name: string, args: Record<string, unknown> = {}) => {
  const tool = agentTools(t.s.context, "c1").find((x) => x.name === name)!;
  return tool.call(args) as Promise<any>;
};

test("schema describes tables with their rules", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\ndone: false\n" }, "tables:\n  tasks:\n    required: [title]\n");
  const s = await call(t, "schema");
  expect(s.tables[0]).toMatchObject({
    name: "tasks",
    key: "id",
    required: ["title"],
    columns: { id: "TEXT", title: "TEXT", done: "BOOLEAN" },
  });
});

test("query reads but never writes", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  expect(await call(t, "query", { sql: "SELECT id, title FROM tasks" })).toEqual({
    columns: ["id", "title"],
    rows: [{ id: "a", title: "A" }],
    truncated: false,
  });
  await expect(call(t, "query", { sql: "DELETE FROM tasks" })).rejects.toThrow(/propose_sql/);
  await expect(call(t, "query", { sql: "SELECT 1; SELECT 2" })).rejects.toThrow(/one statement/);
});

test("get_records returns found records and names the missing ones", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  expect(await call(t, "get_records", { table: "tasks", keys: ["a", "zz"] })).toEqual({
    records: [{ id: "a", title: "A" }],
    missing: ["zz"],
  });
});

test("propose tools create pending proposals and say nothing was saved", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\ndone: false\n" });
  const out = await call(t, "propose_sql", { title: "done", sql: "UPDATE tasks SET done = 1" });
  expect(out).toMatch(
    /^Proposal p_\w+ created: 1 row in tasks \(1 update\)\. Nothing is saved until the user applies it/,
  );
  expect(out).toContain("card in this same chat panel");
  expect(out).not.toContain("yamlite UI");
  const changes = await call(t, "propose_changes", {
    title: "rename",
    changes: [{ table: "tasks", key: "a", op: "update", values: { title: "Z" } }],
  });
  expect(changes).toMatch(/^Proposal p_/);
  expect(t.s.context.proposals.pending()).toHaveLength(2);
});

test("propose_table proposes a table and check reports rule problems", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, "tables:\n  tasks:\n    required: [owner]\n");
  expect(
    await call(t, "propose_table", {
      title: "notes",
      name: "notes",
      mode: "files",
      key: "id",
      columns: { text: "TEXT" },
    }),
  ).toMatch(/a new table notes/);
  const r = await call(t, "check");
  expect(r.tables.map((x: any) => x.table)).toContain("tasks");
});

test("propose_table rejects invalid tables without creating a proposal", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const base = { title: "t", mode: "files", key: "id" };
  await expect(call(t, "propose_table", { ...base, name: "_yamlite_x" })).rejects.toThrow(/table name/);
  await expect(call(t, "propose_table", { ...base, name: "n", columns: { a: "BLOB" } })).rejects.toThrow(
    /type must be one of/,
  );
  await expect(call(t, "propose_table", { ...base, name: "n", columns: "x" })).rejects.toThrow(
    /columns must be an object/,
  );
  await expect(call(t, "propose_table", { ...base, name: "tasks" })).rejects.toThrow(/already exists/);
  expect(t.s.context.proposals.pending()).toHaveLength(0);
});

test("get_records and propose_changes validate their lists", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  await expect(call(t, "get_records", { table: "tasks", keys: "a" })).rejects.toThrow(
    /keys must be an array of at most 100 keys/,
  );
  await expect(
    call(t, "get_records", { table: "tasks", keys: Array.from({ length: 101 }, (_, i) => String(i)) }),
  ).rejects.toThrow(/at most 100/);
  await expect(call(t, "propose_changes", { title: "x", changes: "nope" })).rejects.toThrow(/changes must be an array/);
});

test("query cannot reach internal tables or hide writes in a WITH", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  await expect(call(t, "query", { sql: "SELECT * FROM _yamlite_state" })).rejects.toThrow();
  await expect(call(t, "query", { sql: "WITH x AS (SELECT 1) DELETE FROM tasks" })).rejects.toThrow();
  expect((await call(t, "query", { sql: "SELECT id FROM tasks" })).rows).toHaveLength(1);
});

test("check reports unregistered tables", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  expect(await call(t, "check")).toMatchObject({ ok: true, unregisteredTables: expect.any(Array) });
});

test("guide returns the guide to writing yamlite.yaml", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  expect(await call(t, "guide")).toBe(guide());
});
