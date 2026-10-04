// @vitest-environment node
import { createRequire } from "node:module";
import initSqlJs, { type Database } from "sql.js";
import { beforeAll, expect, test } from "vitest";
import { ApiError } from "../api";
import type { Snapshot, YamlMap } from "../types";
import { createStaticApi } from "./api";

const require = createRequire(import.meta.url);
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
});

function fixture(): Database {
  const db = new SQL.Database();
  db.run(
    `CREATE TABLE tasks ("id" TEXT PRIMARY KEY, "title" TEXT, "done" BOOLEAN, "priority" INTEGER, "tags" JSON, "big" INTEGER)`,
  );
  const rows: Array<[string, string, number, number, string | null, string | null]> = [
    ["a", "Buy milk", 0, 3, '["home","errand"]', null],
    ["a_1", "Call", 1, 1, '["work"]', null],
    ["ab", "Write", 0, 2, null, null],
    ["b", "Read", 0, 5, '["home"]', null],
    ["c", "Sleep", 1, 4, null, "9007199254740993"],
  ];
  for (const r of rows) db.run("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, CAST(? AS INTEGER))", r);
  db.run(
    `CREATE VIEW tasks__tags AS SELECT tasks.id AS tasks_id, j.key AS idx, j.value AS value FROM tasks, json_each(tasks.tags) j`,
  );
  db.run(`CREATE TABLE nums ("id" TEXT PRIMARY KEY, "vals" JSON)`);
  db.run(`INSERT INTO nums VALUES ('n1', '[3]'), ('n2', '[4]')`);
  return db;
}

const columns = {
  id: "TEXT",
  title: "TEXT",
  done: "BOOLEAN",
  priority: "INTEGER",
  tags: "JSON",
  big: "INTEGER",
} as const;
const snapshot: Snapshot = {
  version: 1,
  generatedAt: "2026-10-02T00:00:00.000Z",
  meta: {
    root: "data",
    db: "data/db.sqlite",
    configFile: "yamlite.yaml",
    configError: null,
    tables: [
      {
        name: "tasks",
        mode: "dir",
        path: "tasks",
        key: "id",
        columns: { ...columns },
        references: [],
        count: 5,
        inDb: true,
      },
    ],
    views: [
      {
        name: "tasks__tags",
        table: "tasks",
        parent: "tasks",
        depth: 1,
        columns: { tasks_id: "TEXT", idx: "INTEGER", value: "TEXT" },
        identity: ["tasks_id", "idx"],
        declared: {},
        references: [],
        count: 4,
        inDb: true,
      },
    ],
  },
  schemas: {},
  warnings: {},
};

const yaml: YamlMap = { a: { file: "tasks/a.yaml", yaml: "title: Buy milk\n" } };
const make = (loadYaml: (t: string) => Promise<YamlMap> = async () => yaml) =>
  createStaticApi({ db: fixture(), snapshot, loadYaml });
const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => r.id);

test("rows page, sort and filter like the server", async () => {
  const api = make();
  expect(await api.rows("tasks", { limit: 2, offset: 2, filters: [] })).toMatchObject({ total: 5 });
  expect(ids((await api.rows("tasks", { limit: 2, offset: 2, filters: [] })).rows)).toEqual(["ab", "b"]);
  expect(ids((await api.rows("tasks", { limit: 10, offset: 0, sort: "priority:desc", filters: [] })).rows)).toEqual([
    "b",
    "c",
    "a",
    "ab",
    "a_1",
  ]);
  const done = await api.rows("tasks", { limit: 10, offset: 0, filters: [{ col: "done", op: "eq", value: true }] });
  expect(ids(done.rows)).toEqual(["a_1", "c"]);
  const home = await api.rows("tasks", { limit: 10, offset: 0, filters: [{ col: "tags", op: "has", value: "home" }] });
  expect(ids(home.rows)).toEqual(["a", "b"]);
  expect(ids((await api.rows("tasks", { limit: 10, offset: 0, filters: [], prefix: "a" })).rows)).toEqual([
    "a",
    "a_1",
    "ab",
  ]);
});

test("values come back typed like the server", async () => {
  const { rows } = await make().rows("tasks", { limit: 1, offset: 0, filters: [] });
  expect(rows[0]).toEqual({
    id: "a",
    title: "Buy milk",
    done: false,
    priority: 3,
    tags: ["home", "errand"],
    big: null,
  });
});

test("big integers come back as strings like the server", async () => {
  const { row } = await make().record("tasks", "c");
  expect(row.big).toBe("9007199254740993");
});

test("views page by their identity", async () => {
  const page = await make().rows("tasks__tags", { limit: 10, offset: 0, filters: [], prefix: "a" });
  expect(page.total).toBe(3);
  expect(page.rows.map((r) => [r.tasks_id, r.idx])).toEqual([
    ["a", 0],
    ["a", 1],
    ["a_1", 0],
  ]);
});

test("an unknown column is a 400 like the server", async () => {
  await expect(make().rows("tasks", { limit: 1, offset: 0, sort: "nope:asc", filters: [] })).rejects.toMatchObject({
    status: 400,
    message: "unknown column: nope",
  });
});

test("a record carries its YAML, and a YAML that cannot load is reported on the record", async () => {
  expect(await make().record("tasks", "a")).toEqual({
    row: { id: "a", title: "Buy milk", done: false, priority: 3, tags: ["home", "errand"], big: null },
    file: "tasks/a.yaml",
    yaml: "title: Buy milk\n",
  });
  const failing = make(async () => {
    throw new Error("data/yaml/tasks.json: 404 Not Found");
  });
  expect(await failing.record("tasks", "a")).toMatchObject({
    yaml: null,
    yamlError: "data/yaml/tasks.json: 404 Not Found",
  });
  await expect(make().record("tasks", "zz")).rejects.toMatchObject({ status: 404 });
});

test("meta and schema come from the snapshot, conflicts are empty", async () => {
  const api = make();
  expect(await api.meta()).toBe(snapshot.meta);
  expect(await api.conflicts()).toEqual({ conflicts: [] });
  await expect(api.schema("nope")).rejects.toMatchObject({ status: 404 });
});

test("sql runs reads with the server's shape and refuses everything else", async () => {
  const api = make();
  const r = await api.sql("select id, priority from tasks order by id limit 2");
  expect(r).toMatchObject({
    columns: ["id", "priority"],
    rows: [
      { id: "a", priority: 3 },
      { id: "a_1", priority: 1 },
    ],
    truncated: false,
  });
  await expect(api.sql("update tasks set title = 'x'")).rejects.toMatchObject({ status: 403 });
  await expect(api.sql("select 1; select 2")).rejects.toMatchObject({ status: 400 });
  await expect(api.sql("select * from nope")).rejects.toBeInstanceOf(ApiError);
});

test("writes are refused", async () => {
  const api = make();
  for (const call of [
    () => api.create("tasks", "z", {}),
    () => api.update("tasks", "a", {}, {}),
    () => api.rename("tasks", "a", "z"),
    () => api.remove("tasks", "a"),
    () => api.createTable({ name: "x" }),
    () => api.restore("id"),
    () => api.dismiss("id"),
  ]) {
    await expect(call()).rejects.toMatchObject({ status: 403 });
  }
});

test("integer filters match on columns without affinity like the server", async () => {
  const api = make();
  const has = await api.rows("nums", { limit: 10, offset: 0, filters: [{ col: "vals", op: "has", value: 3 }] });
  expect(ids(has.rows)).toEqual(["n1"]);
  const idx = await api.rows("tasks__tags", { limit: 10, offset: 0, filters: [{ col: "idx", op: "eq", value: 0 }] });
  expect(idx.total).toBe(3);
});
