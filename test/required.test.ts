import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { open } from "../src/index.ts";
import { sql, tmpRoot, waitFor, write } from "./helpers.ts";

function setup(config: string, files: Record<string, string>) {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), config);
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  return root;
}

const warningsOf = (results: Array<{ table: string; warnings: string[] }>, table: string) =>
  results.find((r) => r.table === table)?.warnings ?? [];

describe("required", () => {
  test("a missing or null value is a warning; empty values are values; data still syncs", async () => {
    const root = setup("tables:\n  tasks:\n    required: [title, tags]\n", {
      "tasks/a.yaml": "title: A\ntags: [x]\n",
      "tasks/b.yaml": "tags: [x]\n",
      "tasks/c.yaml": "title: null\ntags: [x]\n",
      "tasks/d.yaml": "title: ''\ntags: []\n",
    });
    const y = await open({ root });
    const results = await y.sync();
    expect(results.find((r) => r.table === "tasks")).toMatchObject({ ok: true, toDb: 4 });
    expect(warningsOf(results, "tasks")).toEqual(["title missing (b, c)"]);
    expect(warningsOf(await y.status(), "tasks")).toEqual(["title missing (b, c)"]);
    await y.close();
  });

  test("a column no record has yet: every record is missing it", async () => {
    const root = setup("tables:\n  tasks:\n    required: [due]\n", {
      "tasks/a.yaml": "title: A\n",
      "tasks/b.yaml": "title: B\n",
    });
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "tasks")).toEqual(["due missing (a, b)"]);
    await y.close();
  });

  test("an empty table has nothing missing, and the key column is never checked", async () => {
    const root = setup("tables:\n  people:\n    required: [id, name]\n", { "people.yaml": "[]\n" });
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "people")).toEqual([]);
    await y.close();
  });

  test("expanded views are checked, with the view's name in front", async () => {
    const root = setup("tables:\n  projects:\n    expand:\n      milestones:\n        required: [state]\n", {
      "projects/release.yaml": "milestones:\n  - state: open\n  - title: no state\n",
    });
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "projects")).toEqual(["projects__milestones: state missing (release/1)"]);
    await y.close();
  });

  test("a NULL written in SQL is checked like one from YAML", async () => {
    const root = setup("tables:\n  tasks:\n    required: [title]\n", { "tasks/a.yaml": "title: A\n" });
    const y = await open({ root });
    await y.sync();
    sql(join(root, ".yamlite", "db.sqlite"), "UPDATE tasks SET title = NULL WHERE id = 'a'");
    expect(warningsOf(await y.sync(), "tasks")).toEqual(["title missing (a)"]);
    await y.close();
  });

  test("watch re-checks a table after its file changes", async () => {
    const root = setup("tables:\n  tasks:\n    required: [title]\n", { "tasks/a.yaml": "title: A\n" });
    const y = await open({ root });
    const seen: string[][] = [];
    const watcher = y.watch({ onSync: (r) => seen.push(r.warnings) });
    await watcher.ready;
    write(join(root, "tasks/a.yaml"), "other: x\n");
    await waitFor(() => seen.some((w) => w.includes("title missing (a)")));
    seen.length = 0;
    write(join(root, "tasks/a.yaml"), "title: B\n");
    await waitFor(() => seen.length > 0 && seen.at(-1)?.length === 0);
    await y.close();
  });

  test("more than ten warnings are cut short", async () => {
    const columns = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const root = setup(`tables:\n  tasks:\n    required: [${columns.join(", ")}]\n`, { "tasks/a.yaml": "title: A\n" });
    const y = await open({ root });
    const warnings = warningsOf(await y.sync(), "tasks");
    expect(warnings).toHaveLength(11);
    expect(warnings[0]).toBe("c0 missing (a)");
    expect(warnings[10]).toBe("… and 2 more required warnings");
    await y.close();
  });
});
