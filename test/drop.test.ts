import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type EngineContext, syncTable } from "../src/engine.ts";
import { open } from "../src/index.ts";
import { Store } from "../src/store.ts";
import type { TableSpec } from "../src/types.ts";
import { read, sql, tmpRoot, write } from "./helpers.ts";

function setup(config: string, files: Record<string, string>) {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), config);
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  return { root, config: join(root, "yamlite.yaml"), db: join(root, ".yamlite", "db.sqlite") };
}

const columnsOf = (db: string) => sql(db, "SELECT name FROM pragma_table_info('tasks')").map((r) => r.name);
const both = "tables:\n  tasks:\n    columns:\n      title: TEXT\n      old: TEXT\n";
const titleOnly = "tables:\n  tasks:\n    columns:\n      title: TEXT\n";

describe("dropping columns", () => {
  test("a column removed from yamlite.yaml is dropped once no file uses it", async () => {
    const t = setup(both, { "tasks/a.yaml": "title: A\nold: x\n" });
    const y = await open({ root: t.root });
    await y.sync();
    write(join(t.root, "tasks/a.yaml"), "title: A\n");
    await y.sync();
    write(t.config, titleOnly);
    await y.close();
    const y2 = await open({ root: t.root });
    expect((await y2.status())[0]?.schema).toMatchObject([{ op: "dropColumn", name: "old" }]);
    expect(columnsOf(t.db)).toEqual(["id", "title", "old"]);
    const r = (await y2.sync())[0];
    expect(r?.schema).toMatchObject([{ op: "dropColumn", name: "old" }]);
    expect(columnsOf(t.db)).toEqual(["id", "title"]);
    expect(read(t.config)).toBe(titleOnly);
    expect((await y2.sync())[0]?.schema).toEqual([]);
    await y2.close();
  });

  test("a removed column that files still use is kept, warned about and not re-registered", async () => {
    const t = setup(both, { "tasks/a.yaml": "title: A\nold: x\n" });
    let y = await open({ root: t.root });
    await y.sync();
    await y.close();
    write(t.config, titleOnly);
    y = await open({ root: t.root });
    const r = (await y.sync())[0];
    expect(r?.schema).toEqual([]);
    expect(r?.registered).toEqual([]);
    expect(r?.warnings.join("\n")).toMatch(
      /"old" was removed from yamlite.yaml but files still use it \(a\); remove it from those files or add it back/,
    );
    expect(columnsOf(t.db)).toEqual(["id", "title", "old"]);
    expect(read(t.config)).toBe(titleOnly);
    await y.close();
  });

  test("a managed index on a dropped column goes with it", async () => {
    const t = setup(
      "tables:\n  tasks:\n    columns:\n      title: TEXT\n      old: TEXT\n    indexes:\n      - [old]\n",
      {
        "tasks/a.yaml": "title: A\n",
      },
    );
    let y = await open({ root: t.root });
    await y.sync();
    await y.close();
    write(t.config, titleOnly);
    y = await open({ root: t.root });
    const r = (await y.sync())[0];
    expect(r?.schema.map((c) => c.op)).toEqual(["dropColumn", "dropIndex"]);
    expect(columnsOf(t.db)).toEqual(["id", "title"]);
    await y.close();
  });

  test("columns that were never declared are registered, not dropped", async () => {
    const t = setup(titleOnly, { "tasks/a.yaml": "title: A\n" });
    const y = await open({ root: t.root });
    await y.sync();
    sql(t.db, "ALTER TABLE tasks ADD COLUMN note TEXT");
    const r = (await y.sync())[0];
    expect(r?.schema).toEqual([]);
    expect(r?.registered).toEqual([{ column: "note", type: "TEXT" }]);
    await y.close();
  });

  test("library mode without yamlite.yaml never drops columns", async () => {
    const root = tmpRoot();
    write(join(root, "tasks/a.yaml"), "title: A\nold: x\n");
    const db = join(root, "db.sqlite");
    const tables = [{ name: "tasks", path: join(root, "tasks") }];
    let y = await open({ db, tables });
    await y.sync();
    await y.close();
    write(join(root, "tasks/a.yaml"), "title: A\n");
    y = await open({ db, tables });
    await y.sync();
    await y.sync();
    expect(sql(db, "SELECT name FROM pragma_table_info('tasks')").map((r) => r.name)).toContain("old");
    await y.close();
  });
  test("a removed column that rows still hold values in is kept, in status and sync", async () => {
    const t = setup(both, { "tasks/a.yaml": "title: A\n", "tasks/b.yaml": "title: B\n" });
    let y = await open({ root: t.root });
    await y.sync();
    await y.close();
    sql(t.db, "UPDATE tasks SET old = 'app' WHERE id = 'b'");
    write(t.config, titleOnly);
    y = await open({ root: t.root });
    const warning =
      /"old" was removed from yamlite.yaml but rows still hold values \(b\); sync them to files or clear the column, or add it back/;
    const s = (await y.status())[0];
    expect(s?.schema).toEqual([]);
    expect(s?.warnings.join("\n")).toMatch(warning);
    const r = (await y.sync())[0];
    expect(r?.schema).toEqual([]);
    expect(r?.warnings.join("\n")).toMatch(warning);
    expect(columnsOf(t.db)).toEqual(["id", "title", "old"]);
    expect(sql(t.db, "SELECT old FROM tasks WHERE id = 'b'")).toEqual([{ old: "app" }]);
    await y.close();
  });

  test("a removed column is kept while a file cannot be read", async () => {
    const t = setup(both, { "tasks/a.yaml": "title: A\n" });
    let y = await open({ root: t.root });
    await y.sync();
    await y.close();
    write(join(t.root, "tasks/b.yaml"), "old: [\n");
    write(t.config, titleOnly);
    y = await open({ root: t.root });
    const s = (await y.status())[0];
    const r = (await y.sync())[0];
    for (const res of [s, r]) {
      expect(res?.schema).toEqual([]);
      expect(res?.warnings.join("\n")).toMatch(
        /"old" was removed from yamlite.yaml but some files could not be read \(b\)/,
      );
    }
    expect(columnsOf(t.db)).toEqual(["id", "title", "old"]);
    await y.close();
  });

  test("a column whose registration failed is not dropped later", () => {
    const root = tmpRoot();
    write(join(root, "tasks/a.yaml"), "title: A\n");
    const stateDir = join(root, ".yamlite");
    const db = join(stateDir, "db.sqlite");
    const ctx: EngineContext = {
      store: new Store(db),
      stateDir,
      register: () => {
        throw new Error("read-only");
      },
    };
    const spec: TableSpec = {
      name: "tasks",
      path: join(root, "tasks"),
      mode: "dir",
      key: "id",
      columns: { title: "TEXT" },
      indexes: [],
      references: [],
      persisted: true,
    };
    syncTable(ctx, spec);
    sql(db, "ALTER TABLE tasks ADD COLUMN note TEXT");
    const first = syncTable(ctx, spec);
    expect(first.registered).toEqual([]);
    expect(first.warnings.join("\n")).toMatch(/could not add new columns to yamlite.yaml: read-only/);
    for (let i = 0; i < 2; i++) expect(syncTable(ctx, spec)).toMatchObject({ ok: true, schema: [] });
    expect(columnsOf(db)).toEqual(["id", "title", "note"]);
    ctx.store.close();
  });
  test("a key removed from the files and yamlite.yaml together is not warned about", async () => {
    const t = setup(both, { "tasks/a.yaml": "title: A\nold: x\n" });
    let y = await open({ root: t.root });
    await y.sync();
    await y.close();
    write(join(t.root, "tasks/a.yaml"), "title: A\n");
    write(t.config, titleOnly);
    y = await open({ root: t.root });
    for (const r of [(await y.status())[0], (await y.sync())[0]]) {
      expect(r?.warnings.join("\n")).not.toMatch(/removed from yamlite.yaml/);
    }
    expect(sql(t.db, "SELECT old FROM tasks")).toEqual([{ old: null }]);
    expect((await y.sync())[0]?.schema).toMatchObject([{ op: "dropColumn", name: "old" }]);
    expect(columnsOf(t.db)).toEqual(["id", "title"]);
    await y.close();
  });
});
