import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { BusyError, Store } from "../src/store.ts";
import type { ColumnType } from "../src/types.ts";
import { sql, tmpRoot } from "./helpers.ts";

const setup = () => {
  const path = join(tmpRoot(), "nested", "db.sqlite");
  return { path, store: new Store(path, { busyTimeoutMs: 0 }) };
};
const cols = (entries: Array<[string, ColumnType]>) => new Map(entries);

test("creates tables and adds missing columns", () => {
  const { store } = setup();
  store.ensureTable(
    "t",
    "id",
    cols([
      ["id", "TEXT"],
      ["n", "INTEGER"],
      ["ok", "BOOLEAN"],
    ]),
  );
  expect(Object.fromEntries(store.columns("t"))).toEqual({ id: "TEXT", n: "INTEGER", ok: "BOOLEAN" });
  store.ensureTable(
    "t",
    "id",
    cols([
      ["id", "TEXT"],
      ["tags", "JSON"],
    ]),
  );
  expect([...store.columns("t").keys()]).toEqual(["id", "n", "ok", "tags"]);
  expect(store.tableExists("t")).toBe(true);
  expect(store.tableExists("nope")).toBe(false);
});

test("upsert, readAll, readRow and delete", () => {
  const { store } = setup();
  store.ensureTable(
    "t",
    "id",
    cols([
      ["id", "TEXT"],
      ["n", "INTEGER"],
      ["s", "TEXT"],
    ]),
  );
  const names = ["id", "n", "s"];
  store.upsert("t", "id", { id: "a", n: 1n, s: "x" }, names);
  store.upsert("t", "id", { id: "a", n: 2n }, names);
  expect(store.readRow("t", "id", "a")).toEqual({ id: "a", n: 2n, s: null });
  store.upsert("t", "id", { id: "b" }, names);
  expect([...store.readAll("t", "id").rows.keys()]).toEqual(["a", "b"]);
  store.delete("t", "id", "a");
  expect(store.readRow("t", "id", "a")).toBeUndefined();
});

test("key-only tables and integer keys", () => {
  const { store } = setup();
  store.ensureTable("k", "id", cols([["id", "TEXT"]]));
  store.upsert("k", "id", { id: "a" }, ["id"]);
  store.upsert("k", "id", { id: "a" }, ["id"]);
  expect([...store.readAll("k", "id").rows.keys()]).toEqual(["a"]);
  store.ensureTable("p", "id", cols([["id", "INTEGER"]]));
  store.upsert("p", "id", { id: 5n }, ["id"]);
  expect(store.readRow("p", "id", 5n)).toEqual({ id: 5n });
  store.ensureTable("r", "id", cols([["id", "REAL"]]));
  store.upsert("r", "id", { id: 2 }, ["id"]);
  expect([...store.readAll("r", "id").rows.keys()]).toEqual(["2"]);
  expect(store.readRow("r", "id", 2)).toEqual({ id: 2 });
  store.delete("r", "id", 2);
  expect(store.readRow("r", "id", 2)).toBeUndefined();
});

test("readAll reports NULL and duplicate keys", () => {
  const { path, store } = setup();
  sql(path, "CREATE TABLE u (id TEXT, v TEXT)");
  sql(path, "INSERT INTO u VALUES ('a', '1'), ('a', '2'), (NULL, '3'), ('b', '4')");
  const r = store.readAll("u", "id");
  expect(r.nullKeys).toBe(1);
  expect([...r.skip]).toEqual(["a"]);
  expect([...r.rows.keys()]).toEqual(["a", "b"]);
});

test("state round trip", () => {
  const { store } = setup();
  store.setState("t", "a", { f: "f1", d: "d1" });
  store.setState("t", "a", { f: "f2", d: null });
  store.setState("u", "a", { f: "x", d: "y" });
  expect(Object.fromEntries(store.getState("t"))).toEqual({ a: { f: "f2", d: null } });
  store.dropState("t", "a");
  expect(store.getState("t").size).toBe(0);
});

test("busy detection and data_version", () => {
  const { path, store } = setup();
  const v = store.dataVersion();
  sql(path, "CREATE TABLE z (a)");
  expect(store.dataVersion()).not.toBe(v);
  const other = new DatabaseSync(path);
  other.exec("BEGIN IMMEDIATE");
  expect(() => store.begin()).toThrow(BusyError);
  other.exec("ROLLBACK");
  other.close();
  store.begin();
  store.rollback();
  store.rollback();
});

describe("execute", () => {
  test("a query returns columns and rows up to the limit", () => {
    const s = new Store(join(tmpRoot(), "db.sqlite"));
    s.exec("CREATE TABLE t (id TEXT, n INTEGER)");
    s.exec("INSERT INTO t VALUES ('a', 1), ('b', 2), ('c', 3)");
    expect(s.execute("SELECT id, n FROM t ORDER BY id", 2)).toEqual({
      columns: ["id", "n"],
      rows: [
        { id: "a", n: 1n },
        { id: "b", n: 2n },
      ],
      changes: 0,
      truncated: true,
    });
    expect(s.execute("SELECT id FROM t WHERE id = 'a'", 10).truncated).toBe(false);
    s.close();
  });

  test("a write returns the number of changed rows", () => {
    const s = new Store(join(tmpRoot(), "db.sqlite"));
    s.exec("CREATE TABLE t (id TEXT)");
    expect(s.execute("INSERT INTO t VALUES ('a'), ('b')", 10)).toEqual({
      columns: null,
      rows: [],
      changes: 2,
      truncated: false,
    });
    s.close();
  });

  test("a locked database raises BusyError", () => {
    const path = join(tmpRoot(), "db.sqlite");
    const a = new Store(path, { busyTimeoutMs: 0 });
    const b = new Store(path, { busyTimeoutMs: 0 });
    a.exec("CREATE TABLE t (id TEXT)");
    a.begin();
    a.exec("INSERT INTO t VALUES ('x')");
    expect(() => b.execute("INSERT INTO t VALUES ('y')", 10)).toThrow(BusyError);
    a.rollback();
    a.close();
    b.close();
  });
});
