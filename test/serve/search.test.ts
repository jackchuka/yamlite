import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { buildSearchSql, parseSearchQuery, toSearchHit } from "../../src/serve/search.ts";
import type { ColumnType, DbRow } from "../../src/types.ts";
import { type Served, startServe } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const config =
  "tables:\n" +
  "  projects:\n    columns:\n      title: TEXT\n      archived: BOOLEAN\n" +
  "  tasks:\n    columns:\n      title: TEXT\n" +
  "  notes:\n    columns:\n      body: TEXT\n";
const files = {
  "projects/alpha.yaml": "title: Alpha site\narchived: false\n",
  "projects/beta.yaml": "title: Beta\narchived: true\n",
  "tasks/alpha.yaml": "title: Ship\n",
  "tasks/alphabet.yaml": "title: Letters\n",
  "tasks/my-alpha.yaml": "title: Mine\n",
  "tasks/t1.yaml": "title: Write about ALPHA\n",
};

test("one search spans every table, ranked by how the key matches", async () => {
  t = await startServe(files, config);
  const { status, body } = await t.api("/api/search?q=Alpha");
  expect(status).toBe(200);
  expect(body.hits).toEqual([
    { table: "projects", key: "alpha", label: "Alpha site", column: "id", value: "alpha", rank: 0, total: 1 },
    { table: "tasks", key: "alpha", label: "Ship", column: "id", value: "alpha", rank: 0, total: 4 },
    { table: "tasks", key: "alphabet", label: "Letters", column: "id", value: "alphabet", rank: 1, total: 4 },
    { table: "tasks", key: "my-alpha", label: "Mine", column: "id", value: "my-alpha", rank: 2, total: 4 },
    {
      table: "tasks",
      key: "t1",
      label: "Write about ALPHA",
      column: "title",
      value: "Write about ALPHA",
      rank: 3,
      total: 4,
    },
  ]);
});

test("per caps each table but total still counts every match", async () => {
  t = await startServe(files, config);
  const { body } = await t.api("/api/search?q=alpha&per=1");
  expect(body.hits.map((h: { table: string; key: string; total: number }) => [h.table, h.key, h.total])).toEqual([
    ["projects", "alpha", 1],
    ["tasks", "alpha", 4],
  ]);
});

test("short queries and bad per are rejected; a huge per is clamped", async () => {
  t = await startServe(files, config);
  expect((await t.api("/api/search?q=a")).status).toBe(400);
  expect((await t.api("/api/search?q=%20a%20")).status).toBe(400);
  expect((await t.api("/api/search")).status).toBe(400);
  expect((await t.api("/api/search?q=alpha&per=x")).status).toBe(400);
  expect((await t.api("/api/search?q=alpha&per=999")).status).toBe(200);
});

test("parseSearchQuery trims, defaults and clamps", () => {
  expect(parseSearchQuery(new URLSearchParams("q=%20ab%20"))).toEqual({ needle: "ab", per: 20 });
  expect(parseSearchQuery(new URLSearchParams("q=ab&per=0"))).toEqual({ needle: "ab", per: 1 });
  expect(parseSearchQuery(new URLSearchParams("q=ab&per=500"))).toEqual({ needle: "ab", per: 200 });
});

test("no searchable table builds no statement", () => {
  expect(buildSearchSql([], "ab", 5)).toBeNull();
  const flags = { name: "flags", key: "on", columns: new Map<string, ColumnType>([["on", "BOOLEAN"]]) };
  expect(buildSearchSql([flags], "ab", 5)).toBeNull();
});

test("quotes in table names and the needle", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE "it's" ("id" TEXT PRIMARY KEY, "title" TEXT, "done" BOOLEAN);
           INSERT INTO "it's" VALUES ('k1', 'Rock''n''roll 100%', 1), ('k2', 'plain', 0)`);
  const columns = new Map<string, ColumnType>([
    ["id", "TEXT"],
    ["title", "TEXT"],
    ["done", "BOOLEAN"],
  ]);
  const table = { name: "it's", key: "id", columns };
  const run = (needle: string) => {
    const built = buildSearchSql([table], needle, 5);
    if (!built) throw new Error("no statement");
    return (db.prepare(built.sql).all(...built.params) as DbRow[]).map(toSearchHit);
  };
  expect(run("k'n")).toEqual([
    {
      table: "it's",
      key: "k1",
      label: "Rock'n'roll 100%",
      column: "title",
      value: "Rock'n'roll 100%",
      rank: 3,
      total: 1,
    },
  ]);
  expect(run("0%")).toEqual([
    {
      table: "it's",
      key: "k1",
      label: "Rock'n'roll 100%",
      column: "title",
      value: "Rock'n'roll 100%",
      rank: 3,
      total: 1,
    },
  ]);
  expect(run("k%")).toEqual([]);
});

test("tables named like the statement's own CTEs are still searched", () => {
  const db = new DatabaseSync(":memory:");
  const columns = new Map<string, ColumnType>([
    ["id", "TEXT"],
    ["title", "TEXT"],
  ]);
  const names = ["needle", "Hits", "ranked"];
  for (const name of names)
    db.exec(
      `CREATE TABLE "${name}" ("id" TEXT PRIMARY KEY, "title" TEXT); INSERT INTO "${name}" VALUES ('alpha', 'x')`,
    );
  const built = buildSearchSql(
    names.map((name) => ({ name, key: "id", columns })),
    "alpha",
    5,
  );
  if (!built) throw new Error("no statement");
  const hits = (db.prepare(built.sql).all(...built.params) as DbRow[]).map(toSearchHit);
  expect(hits.map((h) => h.table).sort()).toEqual(["Hits", "needle", "ranked"]);
});

test("the label comes from a title, name or label column, in that order", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE people ("id" TEXT PRIMARY KEY, "Name" TEXT, "label" TEXT);
           CREATE TABLE flags ("id" TEXT PRIMARY KEY, "note" TEXT);
           INSERT INTO people VALUES ('ab1', 'Aiko', 'designer');
           INSERT INTO flags VALUES ('ab2', 'n')`);
  const built = buildSearchSql(
    [
      {
        name: "people",
        key: "id",
        columns: new Map<string, ColumnType>([
          ["id", "TEXT"],
          ["Name", "TEXT"],
          ["label", "TEXT"],
        ]),
      },
      {
        name: "flags",
        key: "id",
        columns: new Map<string, ColumnType>([
          ["id", "TEXT"],
          ["note", "TEXT"],
        ]),
      },
    ],
    "ab",
    5,
  );
  if (!built) throw new Error("no statement");
  const hits = (db.prepare(built.sql).all(...built.params) as DbRow[]).map(toSearchHit);
  expect(hits.map((h) => [h.table, h.label])).toEqual([
    ["flags", null],
    ["people", "Aiko"],
  ]);
});
