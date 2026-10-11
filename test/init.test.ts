import { cpSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateConfig, init, parseIndexSql } from "../src/init.ts";
import { check } from "../src/check.ts";
import { open } from "../src/index.ts";
import { read, sql, tmpRoot, write } from "./helpers.ts";

const HEADER = [
  "# The schema of record for this folder. yamlite adds new tables and columns here as it finds them;",
  "# edit types, keys and indexes to change the database.",
  "",
];

describe("generateConfig", () => {
  test("keys a list file without ids by a field that names every item once", () => {
    const root = tmpRoot();
    write(join(root, "labels.yaml"), "- slug: bug\n  name: Bug\n- slug: docs\n  name: Docs\n");
    const out = generateConfig({ root });
    expect(out).toContain(
      ["  labels:", "    key: slug", "    columns:", "      slug: TEXT", "      name: TEXT", ""].join("\n"),
    );
  });

  test("prefers slug, key, code and name, then the first field that names every item once", () => {
    const root = tmpRoot();
    write(join(root, "a.yaml"), "- title: A\n  name: x\n- title: B\n  name: y\n");
    write(join(root, "b.yaml"), "- title: A\n  n: 1\n- title: B\n  n: 2\n");
    const out = generateConfig({ root });
    expect(out).toContain(["  a:", "    key: name", ""].join("\n"));
    expect(out).toContain(["  b:", "    key: title", ""].join("\n"));
  });

  test("expands lists of maps and maps of maps, and the lists of maps inside them", () => {
    const root = tmpRoot();
    write(
      join(root, "projects/web.yaml"),
      "milestones:\n  - title: Design\n    tasks:\n      - title: Sketch\ntranslations:\n  en: { title: Web }\n",
    );
    write(join(root, "projects/app.yaml"), "milestones: []\ntranslations: null\n");
    expect(generateConfig({ root })).toContain(
      ["    expand:", "      milestones:", "        expand:", "          tasks: {}", "      translations: {}", ""].join(
        "\n",
      ),
    );
  });

  test("does not expand lists of scalars, mixed lists or maps of scalars", () => {
    const root = tmpRoot();
    write(
      join(root, "posts/a.yaml"),
      "tags: [a, b]\nmixed:\n  - { title: A }\n  - plain\nseo: { title: A, description: B }\n",
    );
    expect(generateConfig({ root })).not.toContain("expand:");
  });

  test("references a table its column is named after when its values are all keys", () => {
    const root = tmpRoot();
    write(join(root, "teams/platform.yaml"), "name: Platform\n");
    write(join(root, "teams/sales.yaml"), "name: Sales\n");
    write(join(root, "people/alice.yaml"), "team: platform\nmanager: null\n");
    write(join(root, "people/bob.yaml"), "team: sales\nmanager: alice\n");
    write(join(root, "people/carol.yaml"), "team: platform\nmanager: alice\n");
    write(join(root, "people/dan.yaml"), "team: platform\nmanager: bob\n");
    write(join(root, "people/erin.yaml"), "team: platform\nmanager: bob\n");
    const out = generateConfig({ root });
    expect(out).toContain(["    references:", "      team: teams", "      manager: people", ""].join("\n"));
  });

  test("references the one table that holds every value of a list or of an expanded item's field", () => {
    const root = tmpRoot();
    write(join(root, "users.yaml"), "- id: u1\n- id: u2\n- id: u3\n");
    write(
      join(root, "projects/web.yaml"),
      "members: [u1, u2]\nmilestones:\n  - title: Design\n    owner: u3\n  - title: Build\n    owner: u1\n",
    );
    const out = generateConfig({ root });
    expect(out).toContain(["    references:", "      members: users", ""].join("\n"));
    expect(out).toContain(
      ["    expand:", "      milestones:", "        references:", "          owner: users", ""].join("\n"),
    );
  });

  test("does not reference a table when any value is missing from its keys, so check passes right away", () => {
    const root = tmpRoot();
    write(join(root, "teams.yaml"), "- id: a\n- id: b\n- id: c\n- id: d\n");
    write(
      join(root, "people.yaml"),
      "- { id: p1, team: a }\n- { id: p2, team: b }\n- { id: p3, team: c }\n- { id: p4, team: d }\n- { id: p5, team: z }\n",
    );
    expect(generateConfig({ root })).not.toContain("references:");
  });

  test("does not reference a field that repeats each record's own key", () => {
    const root = tmpRoot();
    write(join(root, "pages/about.yaml"), "slug: about\n");
    write(join(root, "pages/contact.yaml"), "slug: contact\n");
    expect(generateConfig({ root })).not.toContain("references:");
  });

  test("references nothing on weak evidence", () => {
    const root = tmpRoot();
    write(join(root, "teams.yaml"), "- id: a\n- id: b\n- id: c\n- id: d\n- id: e\n");
    write(join(root, "groups.yaml"), "- id: a\n- id: b\n");
    write(join(root, "numbers.yaml"), "- id: 1\n- id: 2\n- id: 3\n");
    write(
      join(root, "people.yaml"),
      [
        "- { id: p1, team: a, group: x, label: a, rank: 1, single: c }",
        "- { id: p2, team: b, group: y, label: b, rank: 2, single: c }",
        "- { id: p3, team: z, group: z, label: a, rank: 3, single: c }",
        "- { id: p4, team: y, group: w, label: b, rank: 1, single: c }",
        "",
      ].join("\n"),
    );
    expect(generateConfig({ root })).not.toContain("references:");
  });

  test.each(["a-team", "b-content", "c-tasks", "e-slug", "f-site"])(
    "writes the expected config for %s",
    async (name) => {
      const root = tmpRoot();
      cpSync(join(import.meta.dirname, "fixtures/init", name), root, { recursive: true });
      await expect(generateConfig({ root })).toMatchFileSnapshot(`__snapshots__/init/${name}.yaml`);
    },
  );

  test("declares a Markdown table at the deepest folder holding a top-level folder's Markdown files", () => {
    const root = tmpRoot();
    write(join(root, "src/content/blog/hello.md"), "---\ntitle: Hello\ndate: 2026-10-01\n---\nHi\n");
    write(join(root, "src/content/blog/2025/old.md"), "Old post\n");
    write(join(root, "src/components/Card.astro"), "<div />\n");
    write(join(root, "README.md"), "# site\n");
    expect(generateConfig({ root })).toContain(
      [
        "  blog:",
        "    files: src/content/blog/**/*.md",
        "    columns:",
        "      body: TEXT",
        "      title: TEXT",
        "      date: TEXT",
        "    formats:",
        "      date: date",
        "",
      ].join("\n"),
    );
  });

  test("declares Markdown and MDX files of one folder as two tables, and names a clash by its path", () => {
    const root = tmpRoot();
    write(join(root, "blog.yaml"), "- id: 1\n");
    write(join(root, "site/blog/a.md"), "---\ntitle: A\n---\n");
    write(join(root, "site/blog/b.mdx"), "---\ntitle: B\n---\n");
    const out = generateConfig({ root });
    expect(out).toContain(["  site_blog:", "    files: site/blog/**/*.md", ""].join("\n"));
    expect(out).toContain(["  site_blog_mdx:", "    files: site/blog/**/*.mdx", ""].join("\n"));
  });

  test("leaves Markdown in a YAML table's folder and at the root alone, and keeps declared Markdown tables", () => {
    const root = tmpRoot();
    write(join(root, "tasks/a.yaml"), "title: A\n");
    write(join(root, "tasks/README.md"), "# tasks\n");
    write(join(root, "README.md"), "# data\n");
    write(join(root, "notes/a.md"), "---\ntitle: A\n---\n");
    write(join(root, "yamlite.yaml"), 'tables:\n  journal:\n    files: "notes/**/*.md"\n');
    const out = generateConfig({ root, force: true });
    expect(out).toContain("  journal:\n");
    expect(out).toContain("  tasks:\n");
    expect(out.match(/files:/g)).toHaveLength(1);
  });

  test.each(["a-team", "b-content", "c-tasks", "e-slug", "f-site"])(
    "the config written for %s passes check",
    async (name) => {
      const root = tmpRoot();
      cpSync(join(import.meta.dirname, "fixtures/init", name), root, { recursive: true });
      init({ root });
      const result = await check({ root });
      expect(result.tables.filter((t) => !t.ok)).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );

  test("leaves the key alone when no field names every item once, or when items have ids", () => {
    const root = tmpRoot();
    write(join(root, "dupes.yaml"), "- name: x\n- name: x\n");
    write(join(root, "gaps.yaml"), "- name: x\n- other: y\n");
    write(join(root, "lists.yaml"), "- tags: [a]\n- tags: [b]\n");
    write(join(root, "ids.yaml"), "- id: 1\n  slug: a\n- slug: b\n");
    expect(generateConfig({ root })).not.toContain("key:");
  });

  test("infers date and datetime formats for TEXT columns that only hold them", () => {
    const root = tmpRoot();
    write(join(root, "tasks/a.yaml"), "due: 2026-10-06\nat: 2026-10-06T09:00+09:00\nmixed: 2026-10-06\nnote: hi\n");
    write(join(root, "tasks/b.yaml"), "due: 2026-11-01\nat: 2026-10-07\nmixed: soon\nnote: 2026-10-06\n");
    write(join(root, "tasks/c.yaml"), "due: null\n");
    const out = generateConfig({ root });
    expect(out).toContain(["    formats:", "      due: date", "      at: datetime", ""].join("\n"));
    expect(out).not.toContain("mixed: date");
    expect(out).not.toContain("note: date");
  });

  test("infers no format for a column that mixes dates and numbers", () => {
    const root = tmpRoot();
    write(join(root, "tasks/a.yaml"), "when: 2026-10-06\n");
    write(join(root, "tasks/b.yaml"), "when: 5\n");
    expect(generateConfig({ root })).not.toContain("when: date");
  });

  test("leaves declared formats and columns with values alone", () => {
    const root = tmpRoot();
    write(join(root, "tasks/a.yaml"), "due: 2026-10-06\nday: 2026-10-06\n");
    write(
      join(root, "yamlite.yaml"),
      "tables:\n  tasks:\n    formats: { due: markdown }\n    values: { day: [2026-10-06] }\n",
    );
    const out = generateConfig({ root, force: true });
    expect(out).toContain(["    formats:", "      due: markdown", ""].join("\n"));
    expect(out).not.toContain("day: date");
  });

  test("keeps min and max when it rewrites yamlite.yaml", () => {
    const root = tmpRoot();
    write(join(root, "tasks/a.yaml"), "priority: 2\nmilestones:\n  - points: 3\n");
    write(
      join(root, "yamlite.yaml"),
      "tables:\n  tasks:\n    columns: { priority: INTEGER }\n    min: { priority: 1 }\n    max: { priority: 5 }\n    expand: { milestones: { columns: { points: INTEGER }, max: { points: 13 } } }\n",
    );
    const out = generateConfig({ root, force: true });
    expect(out).toContain(["    min:", "      priority: 1", "    max:", "      priority: 5", ""].join("\n"));
    expect(out).toContain(["        max:", "          points: 13", ""].join("\n"));
  });

  test("keeps expand declarations when it rewrites yamlite.yaml", () => {
    const root = tmpRoot();
    write(join(root, "projects/website.yaml"), "title: Website\nmilestones:\n  - title: Design\n");
    write(
      join(root, "yamlite.yaml"),
      "tables:\n  projects:\n    expand:\n      milestones:\n        columns: { points: INTEGER }\n        expand: { tasks: { references: { owner: people } } }\n",
    );
    expect(generateConfig({ root, force: true })).toContain(
      [
        "    expand:",
        "      milestones:",
        "        columns:",
        "          points: INTEGER",
        "        expand:",
        "          tasks:",
        "            references:",
        "              owner: people",
        "",
      ].join("\n"),
    );
  });

  test("keeps formats when it rewrites yamlite.yaml", () => {
    const root = tmpRoot();
    write(join(root, "faqs.yaml"), '- id: 1\n  answer: "# Hi"\n');
    write(
      join(root, "yamlite.yaml"),
      "tables:\n  faqs:\n    formats: { answer: markdown }\n    expand: { tags: { formats: { value: markdown } } }\n",
    );
    const out = generateConfig({ root, force: true });
    expect(out).toContain(["      answer: TEXT", "    formats:", "      answer: markdown", ""].join("\n"));
    expect(out).toContain(["      tags:", "        formats:", "          value: markdown", ""].join("\n"));
  });

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

  test("writes key, path and files only when they differ from the defaults", () => {
    const root = tmpRoot();
    const outside = tmpRoot();
    write(join(outside, "x.yaml"), "a: 1\n");
    write(join(root, "people.yaml"), "- slug: ann\n");
    write(join(root, "content/blog/p.yaml"), "t: x\n");
    write(join(root, "tasks/a.yaml"), "t: y\n");
    write(
      join(root, "yamlite.yaml"),
      `tables:\n  people:\n    key: slug\n  inbox:\n    files: ${outside}/*.yaml\n  posts:\n    files: "content/blog/**/*.yaml"\n`,
    );
    const out = generateConfig({ root, force: true });
    expect(out).toContain(`  inbox:\n    files: ${outside}/*.yaml\n    columns:\n      a: INTEGER\n`);
    expect(out).toContain("  people:\n    key: slug\n    columns:\n      slug: TEXT\n");
    expect(out).toContain("  posts:\n    files: content/blog/**/*.yaml\n");
    expect(out).toContain("  tasks:\n    columns:\n");
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

test("init keeps declared values, in tables and in expand", () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "status: todo\nsteps:\n  - state: open\n");
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  tasks:\n    values:\n      status: [todo, done]\n    expand:\n      steps:\n        values: { state: [open] }\n",
  );
  const out = generateConfig({ root, force: true });
  expect(out).toContain("    values:\n      status:\n        - todo\n        - done\n");
  expect(out).toContain("        values:\n          state:\n            - open\n");
});

test("init keeps declared required, in tables and in expand", () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "title: A\nsteps:\n  - state: open\n");
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  tasks:\n    required: [title]\n    expand:\n      steps:\n        required: [state]\n",
  );
  const out = generateConfig({ root, force: true });
  expect(out).toContain("    required:\n      - title\n");
  expect(out).toContain("        required:\n          - state\n");
});

test("writes files: and body: for declared Markdown tables, declares other folders of Markdown, and no format for the body", () => {
  const root = tmpRoot();
  write(join(root, "blog/a.md"), "---\ntitle: A\n---\ntext\n");
  write(join(root, "yamlite.yaml"), 'tables:\n  posts:\n    files: "src/**/*.md"\n    body: content\n');
  write(join(root, "src/p.md"), "---\nsummary: s\n---\nx\n");
  const out = generateConfig({ root, force: true });
  expect(out).toContain("  blog:\n    files: blog/**/*.md\n");
  expect(out).toContain("  posts:\n    files: src/**/*.md\n    body: content\n");
  expect(out).not.toContain("formats");
});
