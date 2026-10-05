import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { formatCsv, formatJson, formatTable, open, query } from "../src/index.ts";
import { read, sql, tmpRoot, write } from "./helpers.ts";

const textCheck = vi.hoisted(() => ({ bypass: false }));
vi.mock("../src/serve/sqltext.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/serve/sqltext.ts")>();
  return {
    ...original,
    isPageStatement: (s: string) => textCheck.bypass || original.isPageStatement(s),
  };
});

function setup(config: string, files: Record<string, string>) {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), config);
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  return root;
}

const tasks = () =>
  setup("tables:\n  tasks:\n    columns: { title: TEXT, done: BOOLEAN }\n", {
    "tasks/a.yaml": "title: A\ndone: true\n",
    "tasks/b.yaml": "title: B\ndone: false\n",
  });

test("reads the YAML through a throwaway database and writes nothing under root", async () => {
  const root = tasks();
  const before = read(join(root, "yamlite.yaml"));
  const r = await query({ root, sql: "select id, title, done from tasks order by id" });
  expect(r).toEqual({
    columns: ["id", "title", "done"],
    rows: [
      ["a", "A", 1n],
      ["b", "B", 0n],
    ],
    truncated: false,
    warnings: [],
  });
  expect(existsSync(join(root, ".yamlite"))).toBe(false);
  expect(read(join(root, "yamlite.yaml"))).toBe(before);
  expect(readdirSync(root).sort()).toEqual(["tasks", "yamlite.yaml"]);
});

test("runs while watch holds the lock", async () => {
  const root = tasks();
  const y = await open({ root });
  await y.sync();
  const watcher = y.watch();
  await watcher.ready;
  try {
    expect((await query({ root, sql: "select count(*) as n from tasks" })).rows).toEqual([[2n]]);
  } finally {
    await y.close();
  }
});

test("--db reads that database as it is, without syncing", async () => {
  const root = tasks();
  const y = await open({ root });
  await y.sync();
  await y.close();
  const db = join(root, ".yamlite", "db.sqlite");
  sql(db, "UPDATE tasks SET title = 'from sql' WHERE id = 'a'");
  write(join(root, "tasks/b.yaml"), "title: changed in yaml\n");
  const r = await query({ db, sql: "select title from tasks order by id" });
  expect(r.rows).toEqual([["from sql"], ["B"]]);
});

test("a missing --db is an error", async () => {
  await expect(query({ db: join(tmpRoot(), "nope.sqlite"), sql: "select 1" })).rejects.toThrow(/no database at /);
});

test.each([
  ["delete from tasks", /query only reads; use sqlite3 or the web UI to write/],
  ["with x as (select 1) delete from tasks", /query only reads; use sqlite3 or the web UI to write/],
  ["select 1; select 2", /run one statement at a time/],
])("refuses %s", async (statement, error) => {
  await expect(query({ root: tasks(), sql: statement })).rejects.toThrow(error);
});

test("a read-only connection refuses writes the text check lets through", async () => {
  const root = tasks();
  const y = await open({ root });
  await y.sync();
  await y.close();
  const db = join(root, ".yamlite", "db.sqlite");
  // a WITH that writes is refused by text; a write hidden from the text check still fails on the connection
  await expect(query({ db, sql: "with t as (select 1) insert into tasks (id) select 'x' from t" })).rejects.toThrow();
  textCheck.bypass = true;
  try {
    await expect(query({ db, sql: "delete from tasks" })).rejects.toThrow(/readonly/);
    await expect(query({ db, sql: "insert into tasks (id) values ('x')" })).rejects.toThrow(/readonly/);
  } finally {
    textCheck.bypass = false;
  }
  expect(sql(db, "select count(*) as n from tasks")).toEqual([{ n: 2 }]);
});

test("an SQL error is thrown", async () => {
  await expect(query({ root: tasks(), sql: "select nope from tasks" })).rejects.toThrow(/no such column/);
});

test("limit cuts the rows and says so; 0 means no limit", async () => {
  const root = tasks();
  expect(await query({ root, sql: "select id from tasks order by id", limit: 1 })).toMatchObject({
    rows: [["a"]],
    truncated: true,
  });
  expect(await query({ root, sql: "select id from tasks order by id", limit: 0 })).toMatchObject({
    rows: [["a"], ["b"]],
    truncated: false,
  });
});

test("a table that fails to sync is a warning and the query still runs", async () => {
  const root = setup("tables:\n  people: {}\n  tasks: {}\n", { "people.yaml": "- [\n", "tasks/a.yaml": "title: A\n" });
  const r = await query({ root, sql: "select id from tasks" });
  expect(r.rows).toEqual([["a"]]);
  expect(r.warnings).toHaveLength(1);
  expect(r.warnings[0]).toMatch(/^people: /);
  await expect(query({ root, sql: "select id from people" })).rejects.toThrow(/no such table/);
});

test("a skipped file in a directory table is a warning, and the good files still read", async () => {
  const root = setup("tables:\n  tasks: {}\n", { "tasks/a.yaml": "title: A\n", "tasks/bad.yaml": "- [\n" });
  const r = await query({ root, sql: "select id from tasks" });
  expect(r.rows).toEqual([["a"]]);
  expect(r.warnings.length).toBeGreaterThan(0);
  for (const w of r.warnings) expect(w).toMatch(/^tasks: /);
});

test("empty or comment-only SQL has no statement to run", async () => {
  for (const text of ["", "  ;  ", "-- nothing\n"]) {
    await expect(query({ root: tasks(), sql: text })).rejects.toThrow(/no statement to run/);
  }
});

const result = {
  columns: ["id", "id", "note", "n"],
  rows: [
    ["a", "b", 'say "hi", then\nleave', 9007199254740993n],
    ["c", null, null, 3n],
  ],
  truncated: false,
  warnings: [],
};

test("formatTable aligns columns, shows NULL as blank and newlines as ↵", () => {
  expect(formatTable(result)).toBe(
    [
      "id  id  note                  n",
      "--  --  --------------------  ----------------",
      'a   b   say "hi", then↵leave  9007199254740993',
      "c                             3",
    ].join("\n"),
  );
});

test("formatTable pads by display width, so Japanese counts as 2 columns", () => {
  const r = {
    columns: ["name", "n"],
    rows: [
      ["日本語", 1n],
      ["ab", 22n],
    ],
    truncated: false,
    warnings: [],
  };
  expect(formatTable(r)).toBe(["name    n", "------  --", "日本語  1", "ab      22"].join("\n"));
});

test("formatJson never reuses a name, even one a later column already has", () => {
  const r = { columns: ["id", "id", "id_2"], rows: [[1n, 2n, 3n]], truncated: false, warnings: [] };
  expect(JSON.parse(formatJson(r))).toEqual([{ id: 1, id_3: 2, id_2: 3 }]);
});

test("formatJson keeps duplicate columns apart and big integers exact", () => {
  expect(JSON.parse(formatJson(result))).toEqual([
    { id: "a", id_2: "b", note: 'say "hi", then\nleave', n: "9007199254740993" },
    { id: "c", id_2: null, note: null, n: 3 },
  ]);
});

test("formatCsv quotes commas, quotes and newlines", () => {
  expect(formatCsv(result)).toBe(
    ["id,id,note,n", 'a,b,"say ""hi"", then\nleave",9007199254740993', "c,,,3", ""].join("\n"),
  );
});
