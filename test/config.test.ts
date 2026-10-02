import { mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { expandPath, resolveConfig } from "../src/config.ts";
import { dataRoot, tmpRoot, write } from "./helpers.ts";

test("discovers tables by convention", () => {
  const root = tmpRoot();
  mkdirSync(join(root, "tasks"));
  write(join(root, "people.yaml"), "[]\n");
  write(join(root, "other.yml"), "[]\n");
  mkdirSync(join(root, ".hidden"));
  mkdirSync(join(root, "node_modules"));
  write(join(root, "notes.txt"), "x");
  write(join(root, "yamlite.yaml"), "tables: {}\n");

  const cfg = resolveConfig({ root });
  expect(cfg.tables.map((t) => [t.name, t.mode])).toEqual([
    ["other", "list"],
    ["people", "list"],
    ["tasks", "dir"],
  ]);
  expect(cfg.tables[2]).toEqual({
    name: "tasks",
    path: join(root, "tasks"),
    mode: "dir",
    key: "id",
    columns: {},
    indexes: [],
    references: [],
    persisted: true,
    exclude: [],
    expand: [],
  });
  expect(cfg.db).toBe(join(root, ".yamlite", "db.sqlite"));
  expect(cfg.stateDir).toBe(join(root, ".yamlite"));
});

test("yamlite.yaml overrides discovered tables and adds outside ones", () => {
  const root = tmpRoot();
  const outside = tmpRoot();
  write(join(root, "people.yaml"), "[]\n");
  write(
    join(root, "yamlite.yaml"),
    `tables:\n  people:\n    key: slug\n    columns: { age: integer }\n  inbox:\n    path: ${outside}\n  rel:\n    path: ../x.yaml\n`,
  );
  const t = Object.fromEntries(resolveConfig({ root }).tables.map((x) => [x.name, x]));
  expect(t.people).toMatchObject({
    key: "slug",
    columns: { age: "INTEGER" },
    mode: "list",
  });
  expect(t.inbox).toMatchObject({ path: outside, mode: "dir" });
  expect(t.rel).toMatchObject({ path: resolve(root, "../x.yaml"), mode: "list" });
});

test("--db overrides the default database path", () => {
  const root = dataRoot();
  expect(resolveConfig({ root, db: join(root, "x.db") }).db).toBe(join(root, "x.db"));
});

test("expands ~", () => {
  expect(expandPath("~/x", "/tmp")).toBe(join(homedir(), "x"));
  expect(expandPath("y", "/tmp")).toBe("/tmp/y");
});

test("a listed table without a path defaults to <root>/<name>", () => {
  const root = tmpRoot();
  write(join(root, "people.yml"), "[]\n");
  write(join(root, "yamlite.yaml"), "tables:\n  people: {}\n  notes: {}\n");
  const t = Object.fromEntries(resolveConfig({ root }).tables.map((x) => [x.name, x.path]));
  expect(t).toEqual({ people: join(root, "people.yml"), notes: join(root, "notes") });
});

test("requires yamlite.yaml unless asked not to", () => {
  const root = tmpRoot();
  expect(() => resolveConfig({ root })).toThrow(/no yamlite.yaml/);
  expect(resolveConfig({ root }, { requireConfig: false }).tables).toEqual([]);
});

test("rejects bad configs", () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables:\n  ghost:\n    key: id\n");
  expect(resolveConfig({ root }).tables[0]).toMatchObject({ name: "ghost", path: join(root, "ghost"), mode: "dir" });

  const root2 = tmpRoot();
  write(join(root2, "p.yaml"), "[]\n");
  write(join(root2, "yamlite.yaml"), "tables:\n  p:\n    columns: { a: DATE }\n");
  expect(() => resolveConfig({ root: root2 })).toThrow(/unknown column type DATE/);

  expect(() => resolveConfig({ root: join(root, "missing") })).toThrow(/not a directory/);
  expect(() => resolveConfig({})).toThrow(/root or db/);
  expect(() =>
    resolveConfig({
      db: "/tmp/x.db",
      tables: [{ name: "_yamlite_x", path: "/tmp/q" }],
    }),
  ).toThrow(/invalid table name/);
});

test("rejects table names that are not plain names", () => {
  for (const name of ["a/b", "a\\b", "a\0b", ".", "..", "x..y"]) {
    expect(() => resolveConfig({ db: "/tmp/x.db", tables: [{ name, path: "/tmp/q" }] })).toThrow(/invalid table name/);
  }
});

test("discovers symlinked tables", () => {
  const root = dataRoot();
  const outside = tmpRoot();
  write(join(outside, "tasks", "a.yaml"), "x: 1\n");
  write(join(outside, "people.yaml"), "[]\n");
  symlinkSync(join(outside, "tasks"), join(root, "tasks"));
  symlinkSync(join(outside, "people.yaml"), join(root, "people.yaml"));
  symlinkSync(join(outside, "missing"), join(root, "broken"));
  expect(resolveConfig({ root }).tables.map((t) => [t.name, t.mode])).toEqual([
    ["people", "list"],
    ["tasks", "dir"],
  ]);
});

test("library mode keeps state next to the database", () => {
  const cfg = resolveConfig({
    db: "/tmp/a/b.sqlite",
    tables: [{ name: "t", path: "/tmp/a/t" }],
  });
  expect(cfg.stateDir).toBe("/tmp/a/.yamlite");
  expect(cfg.tables[0]?.mode).toBe("dir");
});

test("parses index declarations", () => {
  const root = tmpRoot();
  write(join(root, "people.yaml"), "[]\n");
  write(
    join(root, "yamlite.yaml"),
    [
      "tables:",
      "  people:",
      "    indexes:",
      "      - [team, age]",
      "      - { columns: slug, unique: true }",
      `      - { expr: "json_extract(meta, '$.ja')" }`,
      "",
    ].join("\n"),
  );
  expect(resolveConfig({ root }).tables[0]?.indexes).toEqual([
    { columns: ["team", "age"], unique: false },
    { columns: ["slug"], unique: true },
    { expr: "json_extract(meta, '$.ja')", unique: false },
  ]);
});

test("rejects malformed index declarations", () => {
  const root = tmpRoot();
  write(join(root, "people.yaml"), "[]\n");
  for (const bad of [
    "[[]]",
    "[{ unique: true }]",
    "[{ columns: [a], expr: x }]",
    "[{ columns: [a], unique: yes-ish }]",
    "[42]",
  ]) {
    write(join(root, "yamlite.yaml"), `tables:\n  people:\n    indexes: ${bad}\n`);
    expect(() => resolveConfig({ root }), bad).toThrow(/index #1 must be/);
  }
});

test("a malformed yamlite.yaml is reported on one line with its path", () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables: [oops\n");
  expect(() => resolveConfig({ root })).toThrow(/^invalid .*yamlite\.yaml: [^\n]+$/);
});

test("rejects an index expr with more than one statement or a comment", () => {
  const root = dataRoot();
  for (const expr of ["title); ATTACH DATABASE 'x.db' AS x; --", "title) -- x", "title /* x */"]) {
    write(join(root, "yamlite.yaml"), `tables:\n  people:\n    indexes:\n      - { expr: ${JSON.stringify(expr)} }\n`);
    expect(() => resolveConfig({ root }), expr).toThrow('table "people": index #1 expr must be a single expression');
  }
});

test("tables passed in code are not persisted, the ones from the root are", () => {
  const root = dataRoot();
  const outside = tmpRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const tables = resolveConfig({ root, tables: [{ name: "inbox", path: outside }] }).tables;
  expect(tables.map((t) => [t.name, t.persisted])).toEqual([
    ["tasks", true],
    ["inbox", false],
  ]);
  expect(
    resolveConfig({ db: join(root, "x.db"), tables: [{ name: "inbox", path: outside }] }).tables[0]?.persisted,
  ).toBe(false);
});

test("a directory table excludes the paths of tables nested inside it", () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  write(join(root, "tasks/archive/b.yaml"), "x: 1\n");
  write(join(root, "tasks/people.yaml"), "- id: 1\n");
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  tasks: {}\n  archive:\n    path: tasks/archive\n  people:\n    path: tasks/people.yaml\n",
  );
  const byName = new Map(resolveConfig({ root }).tables.map((t) => [t.name, t.exclude]));
  expect(byName.get("tasks")).toEqual([join(root, "tasks/archive"), join(root, "tasks/people.yaml")]);
  expect(byName.get("archive")).toEqual([]);
  expect(byName.get("people")).toEqual([]);
});

test("expand declares views over JSON columns, nested", () => {
  const root = dataRoot();
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  projects:\n    expand:\n      milestones:\n        columns: { points: integer }\n        expand:\n          tasks:\n            references: { owner: people.slug }\n      tags: ~\n",
  );
  const t = resolveConfig({ root }).tables.find((x) => x.name === "projects");
  expect(t?.expand).toEqual([
    {
      field: "milestones",
      name: "projects__milestones",
      columns: { points: "INTEGER" },
      references: [],
      expand: [
        {
          field: "tasks",
          name: "projects__milestones__tasks",
          columns: {},
          references: [{ column: "owner", table: "people", target: "slug" }],
          expand: [],
        },
      ],
    },
    { field: "tags", name: "projects__tags", columns: {}, references: [], expand: [] },
  ]);
});

test.each([
  ["      milestones: { colums: {} }\n", /expand\.milestones has an unknown key "colums"/],
  ["      milestones: { columns: { a: nope } }\n", /expand\.milestones: unknown column type nope for "a"/],
  [
    "      milestones: { references: { a: x.y.z } }\n",
    /expand\.milestones\.references\.a must be "table" or "table\.column"/,
  ],
  ["      milestones: [a]\n", /expand\.milestones must be a map of columns, references and expand/],
])("rejects a malformed expand: %s", (body, error) => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), `tables:\n  projects:\n    expand:\n${body}`);
  expect(() => resolveConfig({ root })).toThrow(error);
});

test("a view name must not clash with a table or another view", () => {
  const root = dataRoot();
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  projects:\n    expand: { milestones: {} }\n  projects__milestones: {}\n",
  );
  expect(() => resolveConfig({ root })).toThrow(
    /view name "projects__milestones" is already used by table "projects__milestones"/,
  );
  write(join(root, "yamlite.yaml"), "tables:\n  a:\n    expand: { b__c: {} }\n  a__b:\n    expand: { c: {} }\n");
  expect(() => resolveConfig({ root })).toThrow(/view name "a__b__c" is already used by a view of table "a"/);
});
