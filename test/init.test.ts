import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateConfig, init, parseIndexSql } from "../src/init.ts";
import { open } from "../src/index.ts";
import { read, sql, tmpRoot, write } from "./helpers.ts";

const HEADER = [
  "# The schema of record for this folder. yamlite adds new tables and columns here as it finds them;",
  "# edit types, keys and indexes to change the database.",
  "",
];

describe("generateConfig", () => {
  test("infers from YAML when there is no database", () => {
    const root = tmpRoot();
    write(join(root, "tasks/a.yaml"), "title: A\ndone: false\ntags: [x]\n");
    write(join(root, "tasks/b.yaml"), "title: B\nratio: 1.5\n");
    write(join(root, "people.yaml"), "- id: 1\n  name: Ann\n");
    expect(generateConfig({ root })).toBe(
      [
        ...HEADER,
        "tables:",
        "  people:",
        "    columns:",
        "      id: INTEGER",
        "      name: TEXT",
        "  tasks:",
        "    columns:",
        "      title: TEXT",
        "      done: BOOLEAN",
        "      tags: JSON",
        "      ratio: REAL",
        "",
      ].join("\n"),
    );
  });

  test("uses the database's columns and indexes when it exists", async () => {
    const root = tmpRoot();
    write(join(root, "tasks/a.yaml"), "title: A\npriority: 1\n");
    write(
      join(root, "yamlite.yaml"),
      "tables:\n  tasks:\n    columns: { priority: TEXT }\n    indexes:\n      - [title]\n",
    );
    const y = await open({ root });
    await y.sync();
    await y.close();
    const db = join(root, ".yamlite", "db.sqlite");
    sql(db, "CREATE UNIQUE INDEX by_priority ON tasks (priority)");
    sql(db, "ALTER TABLE tasks ADD COLUMN extra REAL");
    expect(generateConfig({ root, force: true })).toBe(
      [
        ...HEADER,
        "tables:",
        "  tasks:",
        "    columns:",
        "      title: TEXT",
        "      priority: TEXT",
        "      extra: REAL",
        "    indexes:",
        "      - [title]",
        '      # replaces index "by_priority" created outside yamlite; drop it after adopting',
        "      - {columns: [priority], unique: true}",
        "",
      ].join("\n"),
    );
  });

  test("writes key and path only when they differ from the defaults", () => {
    const root = tmpRoot();
    const outside = tmpRoot();
    write(join(outside, "x.yaml"), "a: 1\n");
    write(join(root, "people.yaml"), "- slug: ann\n");
    write(join(root, "yamlite.yaml"), `tables:\n  people:\n    key: slug\n  inbox:\n    path: ${outside}\n`);
    const out = generateConfig({ root, force: true });
    expect(out).toContain(`  inbox:\n    path: ${outside}\n    columns:\n      a: INTEGER\n`);
    expect(out).toContain("  people:\n    key: slug\n    columns:\n      slug: TEXT\n");
  });

  test("refuses mixed shapes and an existing file without force", () => {
    const root = tmpRoot();
    write(join(root, "tasks/a.yaml"), "title: A\n");
    write(join(root, "tasks/b.yaml"), "title: {en: B}\n");
    expect(() => generateConfig({ root })).toThrow(/tasks: "title" mixes scalar and map\/list values/);
    write(join(root, "yamlite.yaml"), "tables: {}\n");
    expect(() => generateConfig({ root })).toThrow(/already exists; use --force/);
  });
});

test("init writes the file and the result syncs with the same types", async () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "title: A\nratio: 1.5\n");
  const result = init({ root });
  expect(result).toEqual({ path: join(root, "yamlite.yaml"), tables: ["tasks"] });
  expect(read(result.path)).toContain("      ratio: REAL\n");
  write(join(root, "tasks/a.yaml"), "title: A\nratio: 2\n");
  const y = await open({ root });
  await y.sync();
  await y.close();
  expect(
    sql(join(root, ".yamlite", "db.sqlite"), "SELECT type FROM pragma_table_info('tasks') WHERE name = 'ratio'"),
  ).toEqual([{ type: "REAL" }]);
});

test("open requires yamlite.yaml in root mode", async () => {
  const root = tmpRoot();
  await expect(open({ root })).rejects.toThrow(/no yamlite.yaml in .*; run "yamlite init" to create it/);
});

test("parseIndexSql leaves out partial indexes", () => {
  expect(parseIndexSql('CREATE INDEX i ON t ("a") WHERE (a > 0)')).toBeNull();
  expect(parseIndexSql("CREATE INDEX i ON t (lower(a)) WHERE a IS NOT NULL")).toBeNull();
  expect(parseIndexSql("CREATE INDEX i ON t (lower(a))")).toEqual({ expr: "lower(a)", unique: false });
});

test("init keeps declared references", () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "owner: ann\n");
  write(join(root, "people.yaml"), "- slug: ann\n");
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    references:\n      owner: people.slug\n");
  expect(generateConfig({ root, force: true })).toContain("    references:\n      owner: people.slug\n");
});
