import { mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { expandPath, filesOf, resolveConfig } from "../src/config.ts";
import type { TableSpec } from "../src/types.ts";
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
    ["tasks", "files"],
  ]);
  expect(cfg.tables[2]).toEqual({
    name: "tasks",
    path: join(root, "tasks"),
    mode: "files",
    glob: "**/*.{yaml,yml}",
    codec: "yaml",
    body: null,
    key: "id",
    columns: {},
    formats: {},
    indexes: [],
    references: [],
    values: {},
    required: [],
    min: {},
    max: {},
    persisted: true,
    exclude: [],
    expand: [],
    group: null,
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
    `tables:\n  people:\n    key: slug\n    columns: { age: integer }\n  inbox:\n    files: ${outside}/**/*.yaml\n  rel:\n    path: ../x.yaml\n`,
  );
  const t = Object.fromEntries(resolveConfig({ root }).tables.map((x) => [x.name, x]));
  expect(t.people).toMatchObject({
    key: "slug",
    columns: { age: "INTEGER" },
    mode: "list",
  });
  expect(t.inbox).toMatchObject({ path: outside, mode: "files", glob: "**/*.yaml" });
  expect(t.rel).toMatchObject({ path: resolve(root, "../x.yaml"), mode: "list" });
});

test("formats mark columns the UI edits as markdown, apart from their types", () => {
  const root = tmpRoot();
  write(join(root, "faqs.yaml"), "[]\n");
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  faqs:\n    formats: { answer: Markdown, note: markdown }\n    columns: { answer: TEXT, rank: integer }\n",
  );
  const t = resolveConfig({ root }).tables[0];
  expect(t?.columns).toEqual({ answer: "TEXT", rank: "INTEGER" });
  expect(t?.formats).toEqual({ answer: "markdown", note: "markdown" });
});

test("markdown is not a column type", () => {
  const root = tmpRoot();
  write(join(root, "faqs.yaml"), "[]\n");
  write(join(root, "yamlite.yaml"), "tables:\n  faqs:\n    columns: { answer: markdown }\n");
  expect(() => resolveConfig({ root })).toThrow(/unknown column type markdown/);
});

test.each([
  ["formats: { answer: html }", /unknown format html for "answer"/],
  [
    "formats: { rank: markdown }\n    columns: { rank: INTEGER }",
    /formats\.rank: markdown needs a TEXT column, not INTEGER/,
  ],
  ["formats: [answer]", /formats must be a map of columns to formats/],
])("rejects a bad format: %s", (body, error) => {
  const root = tmpRoot();
  write(join(root, "faqs.yaml"), "[]\n");
  write(join(root, "yamlite.yaml"), `tables:\n  faqs:\n    ${body}\n`);
  expect(() => resolveConfig({ root })).toThrow(error);
});

test("values list the allowed values of a column, as written, without duplicates", () => {
  const root = tmpRoot();
  write(join(root, "tasks.yaml"), "[]\n");
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  tasks:\n    values:\n      status: [todo, done, todo]\n      rank: [1, 2]\n      done: [true]\n    expand:\n      steps:\n        values: { state: [open, closed] }\n",
  );
  const t = resolveConfig({ root }).tables[0];
  expect(t?.values).toEqual({ status: ["todo", "done"], rank: [1, 2], done: [true] });
  expect(t?.expand[0]?.values).toEqual({ state: ["open", "closed"] });
});

test.each([
  ["values: [status]", /values must be a map of columns to lists/],
  ["values: { status: [] }", /values\.status must be a non-empty list of strings, numbers or booleans/],
  ["values: { status: todo }", /values\.status must be a non-empty list of strings, numbers or booleans/],
  ["values: { status: [{ a: 1 }] }", /values\.status must be a non-empty list of strings, numbers or booleans/],
  ["values: { status: [null] }", /values\.status must be a non-empty list of strings, numbers or booleans/],
  ["formats: { note: markdown }\n    values: { note: [a] }", /values\.note: a markdown column cannot have values/],
])("rejects bad values: %s", (body, error) => {
  const root = tmpRoot();
  write(join(root, "tasks.yaml"), "[]\n");
  write(join(root, "yamlite.yaml"), `tables:\n  tasks:\n    ${body}\n`);
  expect(() => resolveConfig({ root })).toThrow(error);
});

test("a Markdown table's body cannot have values", () => {
  const root = tmpRoot();
  write(join(root, "notes/a.md"), "x\n");
  write(join(root, "yamlite.yaml"), 'tables:\n  notes:\n    files: "notes/*.md"\n    values: { body: [a] }\n');
  expect(() => resolveConfig({ root })).toThrow(/values\.body: a markdown column cannot have values/);
});

test("expand entries reject bad values with their path", () => {
  const root = tmpRoot();
  write(join(root, "tasks.yaml"), "[]\n");
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    expand:\n      steps:\n        values: { state: [] }\n");
  expect(() => resolveConfig({ root })).toThrow(/expand\.steps\.values\.state must be a non-empty list/);
});

test("required lists columns that must hold a value, without duplicates", () => {
  const root = tmpRoot();
  write(join(root, "tasks.yaml"), "[]\n");
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  tasks:\n    required: [title, status, title]\n    expand:\n      steps:\n        required: [state]\n",
  );
  const t = resolveConfig({ root }).tables[0];
  expect(t?.required).toEqual(["title", "status"]);
  expect(t?.expand[0]?.required).toEqual(["state"]);
});

test.each([
  ["required: title", /table "tasks": required must be a non-empty list of column names/],
  ["required: []", /table "tasks": required must be a non-empty list of column names/],
  ["required: [1]", /table "tasks": required must be a non-empty list of column names/],
  ["required: ['']", /table "tasks": required must be a non-empty list of column names/],
  [
    "expand:\n      steps:\n        required: {}",
    /table "tasks": expand\.steps\.required must be a non-empty list of column names/,
  ],
])("rejects bad required: %s", (body, error) => {
  const root = tmpRoot();
  write(join(root, "tasks.yaml"), "[]\n");
  write(join(root, "yamlite.yaml"), `tables:\n  tasks:\n    ${body}\n`);
  expect(() => resolveConfig({ root })).toThrow(error);
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
  expect(resolveConfig({ root }).tables[0]).toMatchObject({ name: "ghost", path: join(root, "ghost"), mode: "files" });

  const root2 = tmpRoot();
  write(join(root2, "p.yaml"), "[]\n");
  write(join(root2, "yamlite.yaml"), "tables:\n  p:\n    columns: { a: DATE }\n");
  expect(() => resolveConfig({ root: root2 })).toThrow(/unknown column type DATE/);

  expect(() => resolveConfig({ root: join(root, "missing") })).toThrow(/not a directory/);
  expect(() => resolveConfig({})).toThrow(/root or db/);
  expect(() =>
    resolveConfig({
      db: "/tmp/x.db",
      tables: [{ name: "_yamlite_x", files: "/tmp/q/*.yaml" }],
    }),
  ).toThrow(/invalid table name/);
});

test("rejects table names that are not plain names", () => {
  for (const name of ["a/b", "a\\b", "a\0b", ".", "..", "x..y"]) {
    expect(() => resolveConfig({ db: "/tmp/x.db", tables: [{ name, files: "/tmp/q/*.yaml" }] })).toThrow(
      /invalid table name/,
    );
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
    ["tasks", "files"],
  ]);
});

test("library mode keeps state next to the database", () => {
  const cfg = resolveConfig({
    db: "/tmp/a/b.sqlite",
    tables: [{ name: "t", files: "/tmp/a/t/**/*.yaml" }],
  });
  expect(cfg.stateDir).toBe("/tmp/a/.yamlite");
  expect(cfg.tables[0]?.mode).toBe("files");
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
  const tables = resolveConfig({ root, tables: [{ name: "inbox", files: `${outside}/**/*.yaml` }] }).tables;
  expect(tables.map((t) => [t.name, t.persisted])).toEqual([
    ["tasks", true],
    ["inbox", false],
  ]);
  expect(
    resolveConfig({ db: join(root, "x.db"), tables: [{ name: "inbox", files: `${outside}/**/*.yaml` }] }).tables[0]
      ?.persisted,
  ).toBe(false);
});

test("expand declares views over JSON columns, nested", () => {
  const root = dataRoot();
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  projects:\n    expand:\n      milestones:\n        formats: { notes: markdown }\n        columns: { points: integer }\n        expand:\n          tasks:\n            references: { owner: people.slug }\n      tags: ~\n",
  );
  const t = resolveConfig({ root }).tables.find((x) => x.name === "projects");
  expect(t?.expand).toEqual([
    {
      field: "milestones",
      name: "projects__milestones",
      columns: { points: "INTEGER" },
      formats: { notes: "markdown" },
      references: [],
      values: {},
      required: [],
      min: {},
      max: {},
      expand: [
        {
          field: "tasks",
          name: "projects__milestones__tasks",
          columns: {},
          formats: {},
          references: [{ column: "owner", table: "people", target: "slug" }],
          values: {},
          required: [],
          min: {},
          max: {},
          expand: [],
        },
      ],
    },
    {
      field: "tags",
      name: "projects__tags",
      columns: {},
      formats: {},
      references: [],
      values: {},
      required: [],
      min: {},
      max: {},
      expand: [],
    },
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

test("files: is a glob from the root: its fixed part is the folder, the rest the pattern", () => {
  const root = tmpRoot();
  write(
    join(root, "yamlite.yaml"),
    'tables:\n  posts:\n    files: "content/blog/**/*.yaml"\n  top:\n    files: "*.yml"\n  away:\n    files: ~/inbox/*.yaml\n',
  );
  const t = Object.fromEntries(resolveConfig({ root }).tables.map((x) => [x.name, x]));
  expect(t.posts).toMatchObject({ mode: "files", path: join(root, "content/blog"), glob: "**/*.yaml" });
  expect(t.top).toMatchObject({ mode: "files", path: root, glob: "*.yml" });
  expect(t.away).toMatchObject({ mode: "files", path: join(homedir(), "inbox"), glob: "*.yaml" });
});

test("a path to a folder is refused with the files: line to use instead", () => {
  const root = tmpRoot();
  write(join(root, "inbox/a.yaml"), "x: 1\n");
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    path: ./inbox/\n");
  expect(() => resolveConfig({ root })).toThrow(
    'table "tasks": path must be a YAML file; for one record per file use files: "inbox/**/*.{yaml,yml}"',
  );
  expect(() => resolveConfig({ db: join(root, "x.db"), tables: [{ name: "t", path: "./missing" }] })).toThrow(
    'files: "missing/**/*.{yaml,yml}"',
  );
});

test("a path to the table's own folder says the line can be removed", () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    path: ./tasks\n");
  expect(() => resolveConfig({ root })).toThrow(
    'table "tasks": path must be a YAML file; remove the path: line (the folder tasks/ is the default) or use files: "tasks/**/*.{yaml,yml}"',
  );
});

test("every bad path is reported at once", () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  write(join(root, "notes/a.yaml"), "x: 1\n");
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    path: ./tasks\n  notes:\n    path: ./other/\n");
  let message = "";
  try {
    resolveConfig({ root });
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message.split("\n")).toEqual([
    'table "tasks": path must be a YAML file; remove the path: line (the folder tasks/ is the default) or use files: "tasks/**/*.{yaml,yml}"',
    'table "notes": path must be a YAML file; for one record per file use files: "other/**/*.{yaml,yml}"',
  ]);
});

test("a path to the root suggests files without a leading slash", () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables:\n  all:\n    path: ./\n");
  expect(() => resolveConfig({ root })).toThrow('files: "**/*.{yaml,yml}"');
});

test.each([
  ['    path: a.yaml\n    files: "a/*.yaml"\n', 'table "t": use either path or files, not both'],
  ['    files: "a/*.json"\n', 'table "t": files must end in *.md, *.yaml, *.yml or *.{yaml,yml}'],
  ['    files: "a/**/../*.yaml"\n', 'table "t": files cannot use . or .. after a wildcard'],
])("rejects files: %j", (entry, message) => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), `tables:\n  t:\n${entry}`);
  expect(() => resolveConfig({ root })).toThrow(message);
});

test("a table covering the root stops folder discovery and never claims yamlite.yaml", () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  write(join(root, "people.yaml"), "x: 2\n");
  write(join(root, "yamlite.yaml"), 'tables:\n  docs:\n    files: "**/*.{yaml,yml}"\n');
  const tables = resolveConfig({ root }).tables;
  expect(tables.map((t) => t.name)).toEqual(["docs"]);
  expect(tables[0]?.exclude).toContainEqual({
    owner: "yamlite.yaml",
    path: join(root, "yamlite.yaml"),
    glob: null,
    tie: false,
  });
});

test("a nested files table is claimed from its parent, a list table wins over a glob, a same-folder glob ties", () => {
  const root = tmpRoot();
  write(
    join(root, "yamlite.yaml"),
    'tables:\n  tasks:\n    files: "tasks/**/*.yaml"\n  archive:\n    files: "tasks/archive/*.yaml"\n' +
      '  people:\n    path: tasks/people.yaml\n  other:\n    files: "tasks/*.yaml"\n',
  );
  const t = Object.fromEntries(resolveConfig({ root }).tables.map((x) => [x.name, x]));
  expect(t.tasks?.exclude).toEqual([
    { owner: 'table "archive"', path: join(root, "tasks/archive"), glob: "*.yaml", tie: false },
    { owner: 'table "people"', path: join(root, "tasks/people.yaml"), glob: null, tie: false },
    { owner: 'table "other"', path: join(root, "tasks"), glob: "*.yaml", tie: true },
  ]);
  expect(t.archive?.exclude).toEqual([]);
});

test("filesOf shows a files table the way yamlite.yaml writes it", () => {
  const root = tmpRoot();
  const outside = tmpRoot();
  write(
    join(root, "yamlite.yaml"),
    `tables:\n  tasks: {}\n  docs:\n    files: "*.yml"\n  away:\n    files: ${outside}/**/*.yaml\n`,
  );
  const t = Object.fromEntries(resolveConfig({ root }).tables.map((x) => [x.name, x]));
  expect(filesOf(root, t.tasks as TableSpec)).toBe("tasks/**/*.{yaml,yml}");
  expect(filesOf(root, t.docs as TableSpec)).toBe("*.yml");
  expect(filesOf(root, t.away as TableSpec)).toBe(`${outside}/**/*.yaml`);
});

test("a *.md glob makes a Markdown table whose body column is marked markdown", () => {
  const root = tmpRoot();
  write(
    join(root, "yamlite.yaml"),
    'tables:\n  notes:\n    files: "**/*.md"\n  posts:\n    files: "blog/*.md"\n    body: content\n    formats: { summary: markdown }\n',
  );
  const t = Object.fromEntries(resolveConfig({ root }).tables.map((x) => [x.name, x]));
  expect(t.notes).toMatchObject({ mode: "files", glob: "**/*.md", codec: "markdown", body: "body" });
  expect(t.notes?.formats).toEqual({ body: "markdown" });
  expect(t.posts).toMatchObject({ codec: "markdown", body: "content" });
  expect(t.posts?.formats).toEqual({ content: "markdown", summary: "markdown" });
});

test.each([
  ['    files: "t/**/*.yaml"\n    body: text\n', 'table "t": body is only for *.md files'],
  ['    files: "t/*.md"\n    body: ""\n', 'table "t": body must be a column name'],
  ['    files: "t/*.md"\n    key: text\n    body: text\n', 'table "t": body cannot be the key column'],
])("rejects body: %j", (entry, message) => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), `tables:\n  t:\n${entry}`);
  expect(() => resolveConfig({ root })).toThrow(message);
});

test("discovery never makes Markdown tables: Markdown-only folders and notes at the root are left alone", () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables: {}\n");
  write(join(root, "blog/a.md"), "# a\n");
  write(join(root, "products/a.yaml"), "x: 1\n");
  write(join(root, "products/README.md"), "# about\n");
  write(join(root, "inbox.md"), "# inbox\n");
  write(join(root, ".obsidian/x.md"), "# x\n");
  expect(resolveConfig({ root }).tables.map((t) => [t.name, t.codec, filesOf(root, t)])).toEqual([
    ["products", "yaml", "products/**/*.{yaml,yml}"],
  ]);
});

test("a declared Markdown table sits beside discovered YAML tables", () => {
  const root = tmpRoot();
  write(join(root, "blog/a.md"), "# a\n");
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  write(join(root, "yamlite.yaml"), 'tables:\n  notes:\n    files: "**/*.md"\n');
  expect(resolveConfig({ root }).tables.map((t) => [t.name, t.codec, filesOf(root, t)])).toEqual([
    ["tasks", "yaml", "tasks/**/*.{yaml,yml}"],
    ["notes", "markdown", "**/*.md"],
  ]);
});

test("a folder holding only non-record files is not a table, an empty folder still is", () => {
  const root = tmpRoot();
  write(join(root, "Attachments/a.png"), "x");
  mkdirSync(join(root, "empty"));
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  write(join(root, "yamlite.yaml"), "tables: {}\n");

  const cfg = resolveConfig({ root });
  expect(cfg.tables.map((t) => [t.name, t.codec])).toEqual([
    ["empty", "yaml"],
    ["tasks", "yaml"],
  ]);
});

test("a table's group is read from yamlite.yaml", () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables:\n  people:\n    group: CRM\n  tasks: {}\n");
  const t = Object.fromEntries(resolveConfig({ root }).tables.map((x) => [x.name, x]));
  expect(t.people?.group).toBe("CRM");
  expect(t.tasks?.group).toBeNull();
});

test.each([['group: ""'], ['group: "  "'], ["group: 1"], ["group: [a]"]])("rejects %s", (entry) => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), `tables:\n  t:\n    ${entry}\n`);
  expect(() => resolveConfig({ root })).toThrow('table "t": group must be a non-empty string');
});

const bounded = (yaml: string) => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), yaml);
  return () => resolveConfig({ root });
};

test("min and max: numbers for INTEGER and REAL columns, dates for date and datetime formats", () => {
  const config = bounded(
    [
      "tables:",
      "  tasks:",
      "    columns: { priority: INTEGER, ratio: REAL, due: TEXT, at: TEXT }",
      "    formats: { due: date, at: datetime }",
      "    min: { priority: 1, ratio: 0.5, due: 2026-01-01, at: 2026-01-01 }",
      "    max: { priority: 5, at: 2026-12-31T23:59:59+09:00 }",
      "    expand:",
      "      milestones:",
      "        columns: { points: INTEGER }",
      "        max: { points: 13 }",
      "",
    ].join("\n"),
  )();
  const tasks = config.tables.find((t) => t.name === "tasks")!;
  expect({ ...tasks.min }).toEqual({ priority: 1, ratio: 0.5, due: "2026-01-01", at: "2026-01-01" });
  expect({ ...tasks.max }).toEqual({ priority: 5, at: "2026-12-31T23:59:59+09:00" });
  expect({ ...tasks.expand[0]!.max }).toEqual({ points: 13 });
});

test.each([
  ["    min: { title: 1 }\n", 'table "tasks": min.title needs an INTEGER or REAL column, or a date or datetime format'],
  ["    min: { due: soon }\n", 'table "tasks": min.due: "soon" is not a date'],
  ["    max: { due: 5 }\n", 'table "tasks": max.due: 5 is not a date'],
  ['    max: { priority: "5" }\n', 'table "tasks": max.priority: "5" is not a number'],
  ["    min: { priority: 5 }\n    max: { priority: 1 }\n", 'table "tasks": min.priority (5) is above max.priority (1)'],
  ["    min: [priority]\n", 'table "tasks": min must be a map of columns to numbers or dates'],
  [
    "    min: { at: 2026-01-01T00:00 }\n    max: { at: 2025-12-31 }\n",
    'table "tasks": min.at (2026-01-01T00:00) is above max.at (2025-12-31)',
  ],
])("a bad bound is an error: %s", (lines, error) => {
  const config = bounded(
    "tables:\n  tasks:\n    columns: { priority: INTEGER, title: TEXT, due: TEXT, at: TEXT }\n    formats: { due: date, at: datetime }\n" +
      lines,
  );
  expect(config).toThrow(error);
});

test("a bound in an expand entry needs the type declared there", () => {
  const config = bounded("tables:\n  projects:\n    expand:\n      milestones:\n        max: { points: 13 }\n");
  expect(config).toThrow(
    'table "projects": expand.milestones.max.points needs an INTEGER or REAL column, or a date or datetime format',
  );
});

test("a date column cannot have values", () => {
  const config = bounded("tables:\n  tasks:\n    formats: { due: date }\n    values: { due: [2026-01-01] }\n");
  expect(config).toThrow('table "tasks": values.due: a date column cannot have values');
});
