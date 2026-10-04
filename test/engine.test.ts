import { chmodSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test, vi } from "vitest";
import { type EngineContext, type SyncOptions, syncTable } from "../src/engine.ts";
import { Store } from "../src/store.ts";
import type { Mode, TableSpec } from "../src/types.ts";
import { read, sql, tmpRoot, write } from "./helpers.ts";

function setup(mode: Mode = "files") {
  const root = tmpRoot();
  const stateDir = join(root, ".yamlite");
  const db = join(stateDir, "db.sqlite");
  const ctx: EngineContext = { store: new Store(db, { busyTimeoutMs: 0 }), stateDir };
  const path = mode === "files" ? join(root, "tasks") : join(root, "people.yaml");
  const spec: TableSpec = {
    name: mode === "files" ? "tasks" : "people",
    path,
    mode,
    key: "id",
    columns: {},
    formats: {},
    indexes: [],
    references: [],
    persisted: false,
    glob: mode === "files" ? "**/*.{yaml,yml}" : null,
    exclude: [],
    expand: [],
  };
  return {
    db,
    path,
    spec,
    store: ctx.store,
    file: join(path, "a.yaml"),
    sync: (o: SyncOptions = {}) => syncTable(ctx, spec, o),
  };
}

const types = (db: string, table: string) =>
  sql(db, `SELECT name, type FROM pragma_table_info('${table}')`).map((r) => `${r.name}:${r.type}`);

describe("dir mode", () => {
  test.skipIf(process.getuid?.() === 0)(
    "a subfolder that cannot be searched fails the table and keeps every row",
    () => {
      const t = setup();
      write(join(t.path, "sub/inner/b.yaml"), "n: 1\n");
      write(join(t.path, "a.yaml"), "n: 2\n");
      expect(t.sync()).toMatchObject({ ok: true });
      chmodSync(join(t.path, "sub"), 0o444);
      try {
        expect(t.sync()).toMatchObject({ ok: false, error: expect.stringMatching(/EACCES/) });
        expect(sql(t.db, "SELECT id FROM tasks ORDER BY id")).toEqual([{ id: "a" }, { id: "sub/inner/b" }]);
      } finally {
        chmodSync(join(t.path, "sub"), 0o755);
      }
    },
  );

  test("moving a file between folders deletes the old row and adds the new one", () => {
    const t = setup();
    write(join(t.path, "a/x.yaml"), "n: 1\n");
    write(join(t.path, "b/y.yaml"), "n: 2\n");
    t.sync();
    mkdirSync(join(t.path, "c"));
    renameSync(join(t.path, "a/x.yaml"), join(t.path, "c/x.yaml"));
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, deletedDb: 1, conflicts: [] });
    expect(sql(t.db, "SELECT id FROM tasks ORDER BY id")).toEqual([{ id: "b/y" }, { id: "c/x" }]);
  });

  test("rows inserted and deleted in SQL create and remove nested files", () => {
    const t = setup();
    write(join(t.path, "a.yaml"), "n: 1\n");
    t.sync();
    sql(t.db, "INSERT INTO tasks (id, n) VALUES ('g/h/b', 2)");
    expect(t.sync()).toMatchObject({ ok: true });
    expect(read(join(t.path, "g/h/b.yaml"))).toBe("n: 2\n");
    sql(t.db, "DELETE FROM tasks WHERE id = 'g/h/b'");
    expect(t.sync()).toMatchObject({ ok: true });
    expect(existsSync(join(t.path, "g"))).toBe(false);
  });

  test.skipIf(process.getuid?.() === 0)("an unreadable subfolder fails the table and keeps every row", () => {
    const t = setup();
    write(join(t.path, "a.yaml"), "n: 1\n");
    write(join(t.path, "locked/b.yaml"), "n: 2\n");
    expect(t.sync()).toMatchObject({ ok: true });
    chmodSync(join(t.path, "locked"), 0o000);
    try {
      expect(t.sync()).toMatchObject({ ok: false, error: expect.stringMatching(/EACCES/) });
      expect(sql(t.db, "SELECT id FROM tasks ORDER BY id")).toEqual([{ id: "a" }, { id: "locked/b" }]);
    } finally {
      chmodSync(join(t.path, "locked"), 0o755);
    }
  });

  test("file to db with inferred types, then a no-op", () => {
    const t = setup();
    write(t.file, "title: A\ndone: false\nn: 3\nr: 1.5\ntags: [x]\n");
    expect(t.sync()).toMatchObject({ ok: true, toDb: 1, toFile: 0 });
    expect(sql(t.db, "SELECT * FROM tasks")).toEqual([{ id: "a", title: "A", done: 0, n: 3, r: 1.5, tags: '["x"]' }]);
    expect(types(t.db, "tasks")).toEqual(["id:TEXT", "title:TEXT", "done:BOOLEAN", "n:INTEGER", "r:REAL", "tags:JSON"]);
    expect(t.sync()).toMatchObject({ ok: true, toDb: 0, toFile: 0 });
  });

  test("sql updates are written back keeping comments", () => {
    const t = setup();
    write(t.file, "# my task\ntitle: A # inline\ndone: false\n");
    t.sync();
    sql(t.db, "UPDATE tasks SET done = 1 WHERE id = 'a'");
    expect(t.sync()).toMatchObject({ toFile: 1 });
    expect(read(t.file)).toBe("# my task\ntitle: A # inline\ndone: true\n");
    expect(t.sync()).toMatchObject({ toDb: 0, toFile: 0 });
  });

  test("inserts and deletes propagate both ways", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    sql(t.db, "INSERT INTO tasks (id, title) VALUES ('b', 'B')");
    expect(t.sync()).toMatchObject({ toFile: 1 });
    expect(read(join(t.path, "b.yaml"))).toBe("title: B\n");
    unlinkSync(t.file);
    expect(t.sync()).toMatchObject({ deletedDb: 1 });
    expect(sql(t.db, "SELECT id FROM tasks")).toEqual([{ id: "b" }]);
    sql(t.db, "DELETE FROM tasks WHERE id = 'b'");
    expect(t.sync()).toMatchObject({ deletedFile: 1 });
    expect(existsSync(join(t.path, "b.yaml"))).toBe(false);
  });

  test("renaming a key in the db renames the file", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    sql(t.db, "UPDATE tasks SET id = 'z' WHERE id = 'a'");
    expect(t.sync()).toMatchObject({ toFile: 1, deletedFile: 1 });
    expect(existsSync(t.file)).toBe(false);
    expect(read(join(t.path, "z.yaml"))).toBe("title: A\n");
  });

  test("conflict without db time: db wins and the file version is saved", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    write(t.file, "title: FILE\n");
    sql(t.db, "UPDATE tasks SET title = 'DB' WHERE id = 'a'");
    const r = t.sync();
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ table: "tasks", key: "a", winner: "db" });
    expect(read(t.file)).toBe("title: DB\n");
    expect(read(r.conflicts[0]?.savedTo as string)).toMatch(/^# yamlite: .*"winner":"db".*\ntitle: FILE\n$/);
  });

  test("conflict with an older db time: the newer file wins", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    write(t.file, "title: FILE\n");
    sql(t.db, "UPDATE tasks SET title = 'DB' WHERE id = 'a'");
    const r = t.sync({ dbTime: 0 });
    expect(r.conflicts[0]).toMatchObject({ winner: "file" });
    expect(sql(t.db, "SELECT title FROM tasks")).toEqual([{ title: "FILE" }]);
    expect(read(r.conflicts[0]?.savedTo as string)).toMatch(/^# yamlite: .*"winner":"file".*\ntitle: DB\n$/);
  });

  test("broken files are neither overwritten nor deleted", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    write(t.file, "title: [unclosed\n");
    sql(t.db, "UPDATE tasks SET title = 'DB' WHERE id = 'a'");
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toFile: 0, deletedDb: 0 });
    expect(r.warnings.join("\n")).toMatch(/a\.yaml/);
    expect(read(t.file)).toBe("title: [unclosed\n");
    expect(sql(t.db, "SELECT title FROM tasks")).toEqual([{ title: "DB" }]);
  });

  test("new keys add columns", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    write(t.file, "title: A\nprio: 2\n");
    t.sync();
    expect(types(t.db, "tasks")).toEqual(["id:TEXT", "title:TEXT", "prio:INTEGER"]);
    expect(sql(t.db, "SELECT prio FROM tasks")).toEqual([{ prio: 2 }]);
  });

  test("type mismatches are stored as is and do not loop", () => {
    const t = setup();
    write(t.file, "done: false\n");
    t.sync();
    write(t.file, "done: maybe\n");
    const r = t.sync();
    expect(r).toMatchObject({ toDb: 1 });
    expect(r.warnings.join("\n")).toMatch(/does not match column type BOOLEAN/);
    expect(sql(t.db, "SELECT done FROM tasks")).toEqual([{ done: "maybe" }]);
    expect(t.sync()).toMatchObject({ toDb: 0, toFile: 0 });
  });

  test("refuses when the path disappears after a sync", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    rmSync(t.path, { recursive: true });
    expect(t.sync()).toMatchObject({ ok: false, error: expect.stringMatching(/does not exist/) });
    expect(sql(t.db, "SELECT count(*) AS n FROM tasks")).toEqual([{ n: 1 }]);
  });

  test("refuses when the table disappears after a sync", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    sql(t.db, "DROP TABLE tasks");
    expect(t.sync()).toMatchObject({ ok: false, error: expect.stringMatching(/table "tasks" does not exist/) });
    expect(existsSync(t.file)).toBe(true);
  });

  test("a locked database is reported as busy", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    const other = new DatabaseSync(t.db);
    other.exec("BEGIN IMMEDIATE");
    expect(t.sync()).toMatchObject({ ok: false, busy: true });
    other.exec("ROLLBACK");
    other.close();
    expect(t.sync()).toMatchObject({ ok: true });
  });

  test("dry run reports without writing", () => {
    const t = setup();
    write(t.file, "title: A\n");
    const r = t.sync({ dryRun: true });
    expect(r).toMatchObject({ ok: true, toDb: 1, decisions: [{ key: "a", action: "toDb" }] });
    expect(sql(t.db, "SELECT name FROM sqlite_schema WHERE name = 'tasks'")).toEqual([]);
  });

  test("a dry run reports the same changes and counts as the sync that follows", () => {
    const t = setup();
    for (const k of ["a", "b", "c", "d"]) write(join(t.path, `${k}.yaml`), `title: ${k}\n`);
    t.sync();
    write(join(t.path, "a.yaml"), "title: A2\n");
    unlinkSync(join(t.path, "b.yaml"));
    write(join(t.path, "e.yaml"), "title: e\n");
    sql(t.db, "UPDATE tasks SET title = 'C2' WHERE id = 'c'");
    sql(t.db, "DELETE FROM tasks WHERE id = 'd'");
    const counts = ({ records, toDb, toFile, deletedDb, deletedFile }: ReturnType<typeof t.sync>) => ({
      records,
      toDb,
      toFile,
      deletedDb,
      deletedFile,
    });
    const sorted = (r: ReturnType<typeof t.sync>) => [...r.changes].sort((x, y) => x.key.localeCompare(y.key));
    const planned = t.sync({ dryRun: true });
    const applied = t.sync();
    expect(counts(planned)).toEqual({ records: 3, toDb: 2, toFile: 1, deletedDb: 1, deletedFile: 1 });
    expect(counts(applied)).toEqual(counts(planned));
    expect(sorted(applied)).toEqual(sorted(planned));
  });

  test("a table error keeps the warnings found before it", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    sql(t.db, "INSERT INTO tasks (id, title) VALUES (NULL, 'orphan')");
    write(join(t.path, "b.yaml"), "x: 1\n");
    write(join(t.path, "c.yaml"), "x: [1]\n");
    expect(t.sync()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/"x" mixes scalar and map\/list values/),
      warnings: ['1 rows with NULL "id" are ignored'],
    });
  });

  describe("mass delete guard", () => {
    function twelve() {
      const t = setup();
      for (let i = 0; i < 12; i++) write(join(t.path, `k${i}.yaml`), `n: ${i}\n`);
      t.sync();
      for (let i = 0; i < 12; i++) unlinkSync(join(t.path, `k${i}.yaml`));
      return t;
    }
    const count = (db: string) => sql(db, "SELECT count(*) AS n FROM tasks");

    test("renaming a folder of twelve records is refused and force overrides", () => {
      const t = setup();
      for (let i = 0; i < 12; i++) write(join(t.path, `auto/k${i}.yaml`), `n: ${i}\n`);
      t.sync();
      renameSync(join(t.path, "auto"), join(t.path, "automation"));
      expect(t.sync()).toMatchObject({ ok: false, error: expect.stringMatching(/refusing/) });
      expect(count(t.db)).toEqual([{ n: 12 }]);
      expect(t.sync({ force: true })).toMatchObject({ ok: true, deletedDb: 12 });
      expect(sql(t.db, "SELECT id FROM tasks WHERE id LIKE 'automation/%'")).toHaveLength(12);
    });

    test("is refused through the engine and force overrides", () => {
      const t = twelve();
      expect(t.sync()).toMatchObject({ ok: false, error: expect.stringMatching(/refusing/) });
      expect(count(t.db)).toEqual([{ n: 12 }]);
      expect(t.sync({ force: true })).toMatchObject({ ok: true, deletedDb: 12 });
    });

    test("refuses to delete every record of a small table", () => {
      const t = setup();
      for (const k of ["a", "b", "c"]) write(join(t.path, `${k}.yaml`), "n: 1\n");
      t.sync();
      for (const k of ["a", "b", "c"]) unlinkSync(join(t.path, `${k}.yaml`));
      expect(t.sync()).toMatchObject({ ok: false, error: expect.stringMatching(/refusing/) });
      expect(count(t.db)).toEqual([{ n: 3 }]);
      expect(t.sync({ force: true })).toMatchObject({ ok: true, deletedDb: 3 });
    });

    test("dry run warns and writes nothing", () => {
      const t = twelve();
      const r = t.sync({ dryRun: true });
      expect(r.ok).toBe(true);
      expect(r.warnings.join("\n")).toMatch(/refusing/);
      expect(count(t.db)).toEqual([{ n: 12 }]);
    });
  });

  test("an unrelated sql edit leaves other fields of mixed-type columns untouched", () => {
    const t = setup();
    write(t.file, "title: A\npriority: 1\nflag: true\n");
    write(join(t.path, "b.yaml"), "title: B\npriority: high\nflag: yes-ish\n");
    expect(t.sync()).toMatchObject({ ok: true, toDb: 2 });
    expect(types(t.db, "tasks")).toEqual(["id:TEXT", "title:TEXT", "priority:TEXT", "flag:TEXT"]);
    sql(t.db, "UPDATE tasks SET title = 'A2' WHERE id = 'a'");
    expect(t.sync()).toMatchObject({ ok: true, toFile: 1 });
    expect(read(t.file)).toBe("title: A2\npriority: 1\nflag: true\n");
    expect(t.sync()).toMatchObject({ ok: true, toDb: 0, toFile: 0 });
  });

  test("a sql edit to the text form of a number in a TEXT column reaches the file", () => {
    const t = setup();
    sql(t.db, "CREATE TABLE tasks (id TEXT PRIMARY KEY, v TEXT)");
    write(t.file, "v: 1.5\n");
    expect(t.sync()).toMatchObject({ ok: true, toDb: 1 });
    expect(t.sync()).toMatchObject({ ok: true, toDb: 0, toFile: 0 });
    sql(t.db, "UPDATE tasks SET v = '1.50' WHERE id = 'a'");
    expect(t.sync()).toMatchObject({ ok: true, toFile: 1 });
    expect(read(t.file)).toBe('v: "1.50"\n');
    expect(t.sync()).toMatchObject({ ok: true, toDb: 0, toFile: 0 });
  });

  test("a user table with an untyped key column updates the existing row", () => {
    const t = setup();
    sql(t.db, "CREATE TABLE tasks (id PRIMARY KEY, title)");
    sql(t.db, "INSERT INTO tasks VALUES (5, 'x')");
    expect(t.sync()).toMatchObject({ ok: true, toFile: 1 });
    write(join(t.path, "5.yaml"), "title: y\n");
    expect(t.sync()).toMatchObject({ ok: true, toDb: 1, warnings: [] });
    expect(sql(t.db, "SELECT id, typeof(id) AS type, title FROM tasks")).toEqual([
      { id: 5, type: "integer", title: "y" },
    ]);
    expect(t.sync()).toMatchObject({ ok: true, toDb: 0, toFile: 0, warnings: [] });
  });

  test("a file whose key converts to an existing integer key is skipped", () => {
    const t = setup();
    sql(t.db, "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT)");
    sql(t.db, "INSERT INTO tasks VALUES (5, 'five')");
    expect(t.sync()).toMatchObject({ ok: true, toFile: 1 });
    write(join(t.path, "05.yaml"), "title: other\n");
    for (let i = 0; i < 2; i++) {
      const r = t.sync();
      expect(r).toMatchObject({ ok: true, toDb: 0, toFile: 0, deletedFile: 0 });
      expect(r.warnings.join("\n")).toMatch(/05: .*"5".*skipped/);
    }
    expect(sql(t.db, "SELECT id, title FROM tasks")).toEqual([{ id: 5, title: "five" }]);
    expect(read(join(t.path, "5.yaml"))).toBe("title: five\n");
    expect(read(join(t.path, "05.yaml"))).toBe("title: other\n");
  });

  test("a key too long for a file name is skipped without blocking other writes", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    sql(t.db, "INSERT INTO tasks (id, title) VALUES (?, 'L'), ('zzz', 'Z'), ('aaa', 'AA')", "k".repeat(300));
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toFile: 2 });
    expect(r.warnings.join("\n")).toMatch(/too long/);
    expect(read(join(t.path, "aaa.yaml"))).toBe("title: AA\n");
    expect(read(join(t.path, "zzz.yaml"))).toBe("title: Z\n");
  });

  test("reads the table columns once per sync", () => {
    const t = setup();
    for (const k of ["a", "b", "c"]) write(join(t.path, `${k}.yaml`), `title: ${k}\n`);
    t.sync();
    for (const k of ["a", "b", "c"]) write(join(t.path, `${k}.yaml`), `title: ${k}2\n`);
    const spy = vi.spyOn(t.store, "columns");
    expect(t.sync()).toMatchObject({ ok: true, toDb: 3 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // Review Focus
  test("a user table without the key column is an error and files are untouched", () => {
    const t = setup();
    sql(t.db, "CREATE TABLE tasks (name TEXT)");
    write(t.file, "title: A\n");
    expect(t.sync()).toMatchObject({ ok: false, error: expect.stringMatching(/no key column "id"/) });
    expect(read(t.file)).toBe("title: A\n");
  });

  test("rows with a NULL key are ignored", () => {
    const t = setup();
    sql(t.db, "CREATE TABLE tasks (id TEXT, title TEXT)");
    sql(t.db, "INSERT INTO tasks VALUES (NULL, 'x')");
    write(t.file, "title: A\n");
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toDb: 1, toFile: 0 });
    expect(r.warnings.join("\n")).toMatch(/NULL "id"/);
  });

  test("non-ASCII keys are stable", () => {
    const t = setup();
    const file = join(t.path, "タスク.yaml");
    write(file, "t: 1\n");
    expect(t.sync()).toMatchObject({ toDb: 1 });
    expect(t.sync()).toMatchObject({ toDb: 0, toFile: 0, deletedDb: 0, deletedFile: 0 });
    sql(t.db, "UPDATE tasks SET t = 2 WHERE id = 'タスク'");
    expect(t.sync()).toMatchObject({ toFile: 1 });
    expect(read(file)).toBe("t: 2\n");
  });

  test("empty files become key-only rows; non-mapping files never delete rows", () => {
    const t = setup();
    write(join(t.path, "empty.yaml"), "");
    write(t.file, "x: 1\n");
    t.sync();
    expect(sql(t.db, "SELECT id FROM tasks ORDER BY id")).toEqual([{ id: "a" }, { id: "empty" }]);
    write(t.file, "- 1\n");
    const r = t.sync();
    expect(r.warnings.join("\n")).toMatch(/must be a mapping/);
    expect(sql(t.db, "SELECT count(*) AS n FROM tasks")).toEqual([{ n: 2 }]);
  });
});

describe("list mode", () => {
  test("round trip with integer keys keeping comments", () => {
    const t = setup("list");
    write(t.path, "# people\n- id: 1\n  name: Ann # admin\n  age: 30\n- id: 2\n  name: Bob\n");
    expect(t.sync()).toMatchObject({ toDb: 2 });
    expect(types(t.db, "people")).toEqual(["id:INTEGER", "name:TEXT", "age:INTEGER"]);
    sql(t.db, "UPDATE people SET age = 31 WHERE id = 1");
    sql(t.db, "INSERT INTO people (id, name) VALUES (3, 'Cy')");
    sql(t.db, "DELETE FROM people WHERE id = 2");
    expect(t.sync()).toMatchObject({ toFile: 2, deletedFile: 1 });
    expect(read(t.path)).toBe("# people\n- id: 1\n  name: Ann # admin\n  age: 31\n- id: 3\n  name: Cy\n");
    expect(t.sync()).toMatchObject({ toDb: 0, toFile: 0 });
  });

  test("real keys round trip without needless writes", () => {
    const t = setup("list");
    write(t.path, "- id: 1.5\n  name: A\n- id: 2.0\n  name: B\n");
    expect(t.sync()).toMatchObject({ ok: true, toDb: 2 });
    expect(t.sync()).toMatchObject({ ok: true, toDb: 0, toFile: 0 });
    write(t.path, "- id: 1.5\n  name: A\n- id: 2.0\n  name: B2\n");
    expect(t.sync()).toMatchObject({ ok: true, toDb: 1, toFile: 0 });
    expect(t.sync()).toMatchObject({ ok: true, toDb: 0, toFile: 0 });
    sql(t.db, "UPDATE people SET name = 'A2' WHERE id = 1.5");
    expect(t.sync()).toMatchObject({ ok: true, toFile: 1 });
    expect(read(t.path)).toBe("- id: 1.5\n  name: A2\n- id: 2.0\n  name: B2\n");
    expect(t.sync()).toMatchObject({ ok: true, toDb: 0, toFile: 0 });
  });

  test("a symlinked list file stays a symlink and its target gets the change", () => {
    const t = setup("list");
    const target = join(dirname(t.path), "data", "real.yaml");
    write(target, "- id: 1\n  name: Ann\n");
    symlinkSync(join("data", "real.yaml"), t.path);
    t.sync();
    sql(t.db, "UPDATE people SET name = 'Bo' WHERE id = 1");
    expect(t.sync()).toMatchObject({ ok: true, toFile: 1 });
    expect(lstatSync(t.path).isSymbolicLink()).toBe(true);
    expect(read(target)).toBe("- id: 1\n  name: Bo\n");
  });

  test("a broken file is a table error", () => {
    const t = setup("list");
    write(t.path, "- id: 1\n  name: Ann\n");
    t.sync();
    write(t.path, "- [\n");
    expect(t.sync()).toMatchObject({ ok: false });
    expect(sql(t.db, "SELECT count(*) AS n FROM people")).toEqual([{ n: 1 }]);
  });
});

describe("value shapes", () => {
  test("a new column mixing scalars and maps is a table error and nothing is written", () => {
    const t = setup();
    write(join(t.path, "plain.yaml"), "title: Buy milk\n");
    write(join(t.path, "i18n.yaml"), "title:\n  en: Write\n  ja: 書く\n");
    const r = t.sync();
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/"title" mixes scalar and map\/list values/) });
    expect(r.error).toMatch(/scalar: plain; map\/list: i18n/);
    expect(sql(t.db, "SELECT name FROM sqlite_schema WHERE name = 'tasks'")).toEqual([]);
  });

  test("a map arriving in an existing scalar column skips only that record", () => {
    const t = setup();
    write(t.file, "title: A\n");
    write(join(t.path, "b.yaml"), "title: B\n");
    t.sync();
    write(t.file, "title:\n  en: A\n  ja: あ\n");
    write(join(t.path, "b.yaml"), "title: B2\n");
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toDb: 1 });
    expect(r.warnings.join("\n")).toMatch(/a: "title" must be a scalar \(column type TEXT\)/);
    expect(sql(t.db, "SELECT id, title FROM tasks ORDER BY id")).toEqual([
      { id: "a", title: "A" },
      { id: "b", title: "B2" },
    ]);
  });

  test("a scalar arriving in a JSON column skips only that record", () => {
    const t = setup();
    write(t.file, "title:\n  en: A\n");
    t.sync();
    write(t.file, "title: A\n");
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toDb: 0 });
    expect(r.warnings.join("\n")).toMatch(/a: "title" must be a map or list \(column type JSON\)/);
    expect(r.warnings.join("\n")).toMatch(
      /this file is not synced; change it to a map or list, remove it, or change columns\.title in yamlite\.yaml$/m,
    );
    expect(sql(t.db, "SELECT title FROM tasks")).toEqual([{ title: '{"en":"A"}' }]);
  });

  test("columns overrides decide the shape of a new column", () => {
    const t = setup();
    t.spec.columns = { title: "JSON" };
    write(join(t.path, "plain.yaml"), "title: Buy milk\n");
    write(join(t.path, "i18n.yaml"), "title:\n  en: Write\n");
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toDb: 1 });
    expect(r.warnings.join("\n")).toMatch(/plain: "title" must be a map or list/);
    expect(sql(t.db, "SELECT id FROM tasks")).toEqual([{ id: "i18n" }]);
  });

  test("a non-structured value in a JSON column of the table is not written to the file", () => {
    const t = setup();
    write(t.file, "title:\n  en: A\n");
    t.sync();
    sql(t.db, "UPDATE tasks SET title = 'plain' WHERE id = 'a'");
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toFile: 0 });
    expect(r.warnings.join("\n")).toMatch(/a: "title" in the table is not a JSON map or list/);
    expect(r.warnings.join("\n")).toMatch(
      /not written to the file; set it to NULL or a JSON object\/array, or edit the file/,
    );
    expect(read(t.file)).toBe("title:\n  en: A\n");
  });

  test("editing the file still repairs a row whose JSON column is invalid", () => {
    const t = setup();
    write(t.file, "title: A\nbody:\n  note: x\n");
    t.sync();
    sql(t.db, "UPDATE tasks SET body = 1 WHERE id = 'a'");
    write(t.file, "title: A2\n");
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toDb: 1, toFile: 0 });
    expect(sql(t.db, "SELECT title, body FROM tasks")).toEqual([{ title: "A2", body: null }]);
    const again = t.sync();
    expect(again).toMatchObject({ toDb: 0, toFile: 0 });
    expect(again.warnings).toEqual([]);
  });

  test("a conflict against an invalid JSON column keeps the file version", () => {
    const t = setup();
    write(t.file, "title: A\nbody:\n  note: x\n");
    t.sync();
    sql(t.db, "UPDATE tasks SET body = 'oops' WHERE id = 'a'");
    write(t.file, "title: A\nbody:\n  note: y\n");
    const r = t.sync();
    expect(r.conflicts).toMatchObject([{ key: "a", winner: "file" }]);
    expect(sql(t.db, "SELECT body FROM tasks")).toEqual([{ body: '{"note":"y"}' }]);
    expect(read(t.file)).toBe("title: A\nbody:\n  note: y\n");
  });
});

describe("result details", () => {
  test("reports per-key changes and the record count, for runs and dry runs", () => {
    const t = setup();
    write(t.file, "title: A\n");
    write(join(t.path, "b.yaml"), "title: B\n");
    expect(t.sync({ dryRun: true })).toMatchObject({
      records: 2,
      changes: [
        { key: "a", op: "toDb" },
        { key: "b", op: "toDb" },
      ],
    });
    expect(t.sync()).toMatchObject({ records: 2, changes: [{ op: "toDb" }, { op: "toDb" }] });
    unlinkSync(t.file);
    sql(t.db, "UPDATE tasks SET title = 'B2' WHERE id = 'b'");
    expect(t.sync()).toMatchObject({
      records: 1,
      changes: [
        { key: "a", op: "deleteDb" },
        { key: "b", op: "toFile" },
      ],
    });
    expect(t.sync()).toMatchObject({ records: 1, changes: [] });
  });
});

describe("indexes", () => {
  const managed = (db: string) =>
    sql(db, "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND name GLOB 'yamlite_*' ORDER BY sql").map(
      (r) => String(r.sql).replace(/"yamlite_tasks_[0-9a-f]+"/, "<name>"),
    );

  test("creates declared indexes, then does nothing", () => {
    const t = setup();
    t.spec.indexes = [
      { columns: ["done", "priority"], unique: false },
      { expr: "json_extract(meta, '$.ja')", unique: false },
    ];
    write(t.file, "done: false\npriority: 1\nmeta: {ja: あ}\n");
    const r = t.sync();
    expect(r.schema).toMatchObject([
      { op: "createIndex", definition: "(done, priority)" },
      { op: "createIndex", definition: "(json_extract(meta, '$.ja'))" },
    ]);
    expect(managed(t.db)).toEqual([
      'CREATE INDEX <name> ON "tasks" ("done", "priority")',
      "CREATE INDEX <name> ON \"tasks\" (json_extract(meta, '$.ja'))",
    ]);
    expect(t.sync().schema).toEqual([]);
  });

  test("changing or removing a declaration replaces or drops only managed indexes", () => {
    const t = setup();
    t.spec.indexes = [{ columns: ["done"], unique: false }];
    write(t.file, "done: false\npriority: 1\n");
    t.sync();
    sql(t.db, "CREATE INDEX mine ON tasks (priority)");
    t.spec.indexes = [{ columns: ["priority"], unique: false }];
    expect(t.sync().schema.map((c) => c.op)).toEqual(["dropIndex", "createIndex"]);
    expect(managed(t.db)).toEqual(['CREATE INDEX <name> ON "tasks" ("priority")']);
    t.spec.indexes = [];
    expect(t.sync().schema.map((c) => c.op)).toEqual(["dropIndex"]);
    expect(managed(t.db)).toEqual([]);
    expect(sql(t.db, "SELECT name FROM sqlite_schema WHERE name = 'mine'")).toEqual([{ name: "mine" }]);
  });

  test("an index that cannot be created is a warning and data still syncs", () => {
    const t = setup();
    t.spec.indexes = [
      { columns: ["team"], unique: true },
      { columns: ["missing"], unique: false },
    ];
    write(t.file, "team: x\n");
    write(join(t.path, "b.yaml"), "team: x\n");
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toDb: 2, schema: [] });
    expect(r.warnings.join("\n")).toMatch(/index unique \(team\) not created: UNIQUE constraint failed/);
    expect(r.warnings.join("\n")).toMatch(/index \(missing\) not created: no column "missing"/);
    expect(managed(t.db)).toEqual([]);
  });

  test("an index expr runs as a single statement", () => {
    const t = setup();
    t.spec.indexes = [{ expr: "title); DROP TABLE tasks; --", unique: false }];
    write(t.file, "title: A\n");
    expect(t.sync().ok).toBe(true);
    expect(sql(t.db, "SELECT id FROM tasks")).toEqual([{ id: "a" }]);
  });

  test("a duplicate under a unique index skips only that record", () => {
    const t = setup();
    t.spec.indexes = [{ columns: ["team"], unique: true }];
    write(t.file, "team: x\n");
    t.sync();
    write(join(t.path, "b.yaml"), "team: x\n");
    write(join(t.path, "c.yaml"), "team: y\n");
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toDb: 1 });
    expect(r.warnings.join("\n")).toMatch(/b: UNIQUE constraint failed: tasks\.team; skipped/);
    expect(sql(t.db, "SELECT id, team FROM tasks ORDER BY id")).toEqual([
      { id: "a", team: "x" },
      { id: "c", team: "y" },
    ]);
    expect(t.sync()).toMatchObject({ ok: true, toDb: 0, toFile: 0 });
    write(join(t.path, "b.yaml"), "team: z\n");
    expect(t.sync()).toMatchObject({ ok: true, toDb: 1 });
    expect(sql(t.db, "SELECT team FROM tasks WHERE id = 'b'")).toEqual([{ team: "z" }]);
  });

  test("status plans index changes without creating them", () => {
    const t = setup();
    t.spec.indexes = [{ columns: ["done"], unique: false }];
    write(t.file, "done: false\n");
    expect(t.sync({ dryRun: true }).schema).toMatchObject([{ op: "createIndex", definition: "(done)" }]);
    expect(managed(t.db)).toEqual([]);
  });
});

describe("column type changes", () => {
  const typeOf = (db: string, column: string) =>
    sql(db, `SELECT type FROM pragma_table_info('tasks') WHERE name = '${column}'`)[0]?.type;

  test("TEXT → JSON migration: files converted to maps fill the rebuilt column", () => {
    const t = setup();
    write(t.file, "title: A\n");
    write(join(t.path, "b.yaml"), "title: B\n");
    t.sync();
    t.spec.columns = { title: "JSON" };
    write(t.file, "title:\n  en: A\n");
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, toDb: 1, toFile: 0 });
    expect(r.schema).toMatchObject([{ op: "alterColumn", name: "title", definition: "TEXT → JSON" }]);
    expect(r.warnings.join("\n")).toMatch(/b: "title" must be a map or list/);
    expect(typeOf(t.db, "title")).toBe("JSON");
    expect(sql(t.db, "SELECT id, title FROM tasks ORDER BY id")).toEqual([
      { id: "a", title: '{"en":"A"}' },
      { id: "b", title: null },
    ]);
    expect(read(join(t.path, "b.yaml"))).toBe("title: B\n");
    expect(t.sync()).toMatchObject({ toDb: 0, toFile: 0, schema: [] });
  });

  test("convertible values are kept", () => {
    const t = setup();
    write(t.file, "priority: 1\nflag: 1\n");
    t.sync();
    t.spec.columns = { priority: "TEXT", flag: "BOOLEAN" };
    const r = t.sync();
    expect(r.schema.map((c) => c.definition)).toEqual(["INTEGER → TEXT", "INTEGER → BOOLEAN"]);
    expect(sql(t.db, "SELECT priority, typeof(priority) AS t, flag FROM tasks")).toEqual([
      { priority: "1", t: "text", flag: 1 },
    ]);
    expect(read(t.file)).toBe("priority: 1\nflag: 1\n");
  });

  test("an unsynced DB value that cannot be converted stops the rebuild unless forced", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    sql(t.db, "UPDATE tasks SET title = 'edited' WHERE id = 'a'");
    t.spec.columns = { title: "JSON" };
    const r = t.sync();
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringMatching(/cannot change "title" to JSON: a \("edited"\)/),
    });
    expect(typeOf(t.db, "title")).toBe("TEXT");
    expect(t.sync({ forceConvert: true })).toMatchObject({ ok: true, schema: [{ op: "alterColumn" }] });
    expect(sql(t.db, "SELECT title FROM tasks")).toEqual([{ title: null }]);
  });

  test("tables with triggers, user indexes or constraints are not rebuilt", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    sql(t.db, "CREATE TRIGGER tr AFTER UPDATE ON tasks BEGIN SELECT 1; END");
    t.spec.columns = { title: "JSON" };
    expect(t.sync()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/has a trigger "tr"; change the column type with your own migration/),
    });
  });

  test("managed indexes and other columns survive the rebuild", () => {
    const t = setup();
    t.spec.indexes = [{ columns: ["done"], unique: false }];
    write(t.file, "title: A\ndone: false\n");
    t.sync();
    t.spec.columns = { title: "JSON" };
    write(t.file, "title: [x]\ndone: false\n");
    const r = t.sync();
    expect(r.schema.map((c) => c.op)).toEqual(["alterColumn", "createIndex"]);
    expect(sql(t.db, "SELECT name, type, pk FROM pragma_table_info('tasks')")).toEqual([
      { name: "id", type: "TEXT", pk: 1 },
      { name: "title", type: "JSON", pk: 0 },
      { name: "done", type: "BOOLEAN", pk: 0 },
    ]);
    expect(sql(t.db, "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'index' AND name GLOB 'yamlite_*'")).toEqual(
      [{ n: 1 }],
    );
  });

  test("status plans the change without rebuilding", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    t.spec.columns = { title: "JSON" };
    const planned = t.sync({ dryRun: true });
    expect(planned.schema).toMatchObject([{ op: "alterColumn", definition: "TEXT → JSON" }]);
    expect(planned.warnings.join("\n")).not.toMatch(/in the table is not a JSON map or list/);
    expect(typeOf(t.db, "title")).toBe("TEXT");
  });
  test("values that cannot be converted are refilled from YAML and never removed from the file", () => {
    const t = setup();
    write(t.file, "title: A\nprio: high\n");
    t.sync();
    t.spec.columns = { prio: "INTEGER" };
    const r = t.sync();
    expect(r).toMatchObject({ ok: true, schema: [{ op: "alterColumn" }] });
    expect(sql(t.db, "SELECT prio FROM tasks")).toEqual([{ prio: "high" }]);
    expect(t.sync()).toMatchObject({ toDb: 0, toFile: 0 });
    sql(t.db, "UPDATE tasks SET title = 'B' WHERE id = 'a'");
    expect(t.sync()).toMatchObject({ ok: true, toFile: 1 });
    expect(read(t.file)).toBe("title: B\nprio: high\n");
  });

  test("a skipped file whose value could not be converted is not overwritten by a DB edit", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    t.spec.columns = { title: "JSON" };
    t.sync();
    sql(t.db, "ALTER TABLE tasks ADD COLUMN note TEXT");
    sql(t.db, "UPDATE tasks SET note = 'n' WHERE id = 'a'");
    t.sync();
    expect(read(t.file)).toBe("title: A\n");
  });

  test.each(["files", "list"] as const)("the key column type is never changed (%s mode)", (mode) => {
    const t = setup(mode);
    const file = mode === "files" ? t.file : t.path;
    const content = mode === "files" ? "# keep\ntitle: A\n" : "# keep\n- id: 1 # one\n  name: Ann\n";
    write(file, content);
    t.sync();
    t.spec.columns = { id: mode === "files" ? "INTEGER" : "TEXT" };
    const error = 'cannot change the type of key column "id"; recreate the database (delete .yamlite/) to change it';
    expect(t.sync({ dryRun: true })).toMatchObject({ ok: false, error, schema: [] });
    expect(t.sync()).toMatchObject({ ok: false, error, schema: [] });
    expect(read(file)).toBe(content);
    expect(sql(t.db, `SELECT count(*) AS n FROM ${t.spec.name}`)).toEqual([{ n: 1 }]);
  });

  test("tables with UNIQUE, COLLATE or AUTOINCREMENT are not rebuilt", () => {
    const t = setup();
    sql(t.db, "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, email TEXT UNIQUE COLLATE NOCASE)");
    write(t.file, "title: A\nemail: a@x\n");
    t.sync();
    t.spec.columns = { title: "JSON" };
    expect(t.sync()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/change the column type with your own migration/),
    });
    expect(sql(t.db, "SELECT sql FROM sqlite_schema WHERE name = 'tasks'")[0]?.sql).toMatch(/UNIQUE COLLATE NOCASE/);
  });

  test("force alone does not clear unconvertible unsynced values", () => {
    const t = setup();
    write(t.file, "title: A\n");
    t.sync();
    sql(t.db, "UPDATE tasks SET title = 'edited' WHERE id = 'a'");
    t.spec.columns = { title: "JSON" };
    expect(t.sync({ force: true })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/use --force-convert to set them to NULL/),
    });
    expect(sql(t.db, "SELECT title FROM tasks")).toEqual([{ title: "edited" }]);
  });
  test("a file deleted together with a type change is deleted from the DB", () => {
    const t = setup();
    write(t.file, "title: A\nprio: high\n");
    write(join(t.path, "b.yaml"), "title: B\nprio: 2\n");
    t.sync();
    unlinkSync(t.file);
    t.spec.columns = { prio: "INTEGER" };
    expect(t.sync()).toMatchObject({ ok: true, deletedDb: 1 });
    expect(sql(t.db, "SELECT id FROM tasks")).toEqual([{ id: "b" }]);
    sql(t.db, "UPDATE tasks SET title = 'A2' WHERE id = 'a'");
    t.sync();
    expect(existsSync(t.file)).toBe(false);
  });
});
