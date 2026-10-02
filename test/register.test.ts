import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { registerInConfig } from "../src/configfile.ts";
import { open } from "../src/index.ts";
import { read, sql, tmpRoot, waitFor, write } from "./helpers.ts";

function setup(config: string, files: Record<string, string>) {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), config);
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  return { root, config: join(root, "yamlite.yaml"), db: join(root, ".yamlite", "db.sqlite") };
}

describe("auto-registration", () => {
  test("new YAML keys are added to yamlite.yaml, keeping comments", async () => {
    const t = setup("# my schema\ntables:\n  tasks:\n    columns:\n      title: TEXT # main\n", {
      "tasks/a.yaml": "title: A\n",
    });
    const y = await open({ root: t.root });
    expect((await y.sync())[0]?.registered).toEqual([]);
    write(join(t.root, "tasks/a.yaml"), "title: A\nprio: 2\n");
    expect((await y.sync())[0]?.registered).toEqual([{ column: "prio", type: "INTEGER" }]);
    expect(read(t.config)).toBe(
      "# my schema\ntables:\n  tasks:\n    columns:\n      title: TEXT # main\n      prio: INTEGER\n",
    );
    expect((await y.sync())[0]?.registered).toEqual([]);
    await y.close();
  });

  test("columns an app adds to the database are registered", async () => {
    const t = setup("tables:\n  tasks:\n    columns: { title: TEXT }\n", { "tasks/a.yaml": "title: A\n" });
    const y = await open({ root: t.root });
    await y.sync();
    sql(t.db, "ALTER TABLE tasks ADD COLUMN note TEXT");
    expect((await y.sync())[0]?.registered).toEqual([{ column: "note", type: "TEXT" }]);
    expect(read(t.config)).toBe("tables:\n  tasks:\n    columns: { title: TEXT, note: TEXT }\n");
    await y.close();
  });

  test("tables discovered under the root are registered with their columns", async () => {
    const t = setup("tables: {}\n", { "tasks/a.yaml": "title: A\n", "people.yaml": "- id: 1\n  name: Ann\n" });
    const y = await open({ root: t.root });
    await y.sync();
    expect(read(t.config)).toBe(
      [
        "tables:",
        "  people:",
        "    columns:",
        "      id: INTEGER",
        "      name: TEXT",
        "  tasks:",
        "    columns:",
        "      title: TEXT",
        "",
      ].join("\n"),
    );
    expect(y.tables.find((x) => x.name === "tasks")?.columns).toEqual({ title: "TEXT" });
    await y.close();
  });

  test("status reports registrations without writing yamlite.yaml", async () => {
    const t = setup("tables:\n  tasks: {}\n", { "tasks/a.yaml": "title: A\n" });
    const y = await open({ root: t.root });
    expect((await y.status())[0]?.registered).toEqual([{ column: "title", type: "TEXT" }]);
    expect(read(t.config)).toBe("tables:\n  tasks: {}\n");
    await y.close();
  });

  test("watch registers new keys and settles", async () => {
    const t = setup("tables:\n  tasks:\n    columns:\n      title: TEXT\n", { "tasks/a.yaml": "title: A\n" });
    const y = await open({ root: t.root });
    let syncs = 0;
    const w = y.watch({ onSync: () => syncs++ }, { pollMs: 50, debounceMs: 50 });
    await w.ready;
    write(join(t.root, "tasks/a.yaml"), "title: A\ndone: true\n");
    await waitFor(() => read(t.config).includes("      done: BOOLEAN\n"));
    await waitFor(() => sql(t.db, "SELECT done FROM tasks")[0]?.done === 1);
    const settled = syncs;
    await new Promise((r) => setTimeout(r, 500));
    expect(syncs - settled).toBeLessThanOrEqual(1);
    await y.close();
  });
});

describe("registerInConfig with path and key", () => {
  test("a new table is written with its path and key", () => {
    const root = tmpRoot();
    const file = join(root, "yamlite.yaml");
    write(file, "# schema\ntables: {}\n");
    expect(
      registerInConfig(file, [{ table: "people", path: "./people.yaml", key: "slug", columns: { name: "TEXT" } }]),
    ).toBe(true);
    expect(parse(read(file))).toEqual({
      tables: { people: { path: "./people.yaml", key: "slug", columns: { name: "TEXT" } } },
    });
    expect(read(file).startsWith("# schema\n")).toBe(true);
  });

  test("path and key are ignored for a table that is already listed", () => {
    const root = tmpRoot();
    const file = join(root, "yamlite.yaml");
    write(file, "tables:\n  people:\n    path: ./a.yaml\n");
    expect(registerInConfig(file, [{ table: "people", path: "./b.yaml", key: "slug" }])).toBe(false);
    expect(read(file)).toBe("tables:\n  people:\n    path: ./a.yaml\n");
  });
});
