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

describe("values", () => {
  test("a value outside the list is a warning; data still syncs", async () => {
    const root = setup("tables:\n  tasks:\n    values:\n      status: [todo, done]\n", {
      "tasks/a.yaml": "status: todo\n",
      "tasks/b.yaml": "status: doen\n",
      "tasks/c.yaml": "status: doen\n",
      "tasks/d.yaml": "title: no status\n",
    });
    const y = await open({ root });
    const results = await y.sync();
    expect(results.find((r) => r.table === "tasks")).toMatchObject({ ok: true, toDb: 4 });
    expect(warningsOf(results, "tasks")).toEqual(['status "doen" not in values (b, c)']);
    expect(warningsOf(await y.status(), "tasks")).toEqual(['status "doen" not in values (b, c)']);
    await y.close();
  });

  test("numbers match as text and as numbers, booleans as 1/0", async () => {
    const root = setup(
      "tables:\n  tasks:\n    columns: { rank: TEXT, score: REAL, done: BOOLEAN }\n    values:\n      rank: [1, 2]\n      score: [1, 2]\n      done: [true]\n",
      {
        "tasks/a.yaml": "rank: '1'\nscore: 2.0\ndone: true\n",
        "tasks/b.yaml": "rank: '3'\nscore: 2.5\ndone: false\n",
      },
    );
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "tasks")).toEqual([
      'rank "3" not in values (b)',
      'score "2.5" not in values (b)',
      'done "0" not in values (b)',
    ]);
    await y.close();
  });

  test("each item of a list column is checked", async () => {
    const root = setup("tables:\n  tasks:\n    values:\n      tags: [home, work]\n", {
      "tasks/a.yaml": "tags: [home, gym, {x: 1}]\n",
    });
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "tasks")).toEqual(['tags "gym" not in values (a)']);
    await y.close();
  });

  test("expanded views are checked, with the view's name in front", async () => {
    const root = setup(
      "tables:\n  projects:\n    expand:\n      milestones:\n        values: { state: [open, closed] }\n",
      { "projects/release.yaml": "milestones:\n  - state: open\n  - state: close\n" },
    );
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "projects")).toEqual([
      'projects__milestones: state "close" not in values (release/1)',
    ]);
    await y.close();
  });

  test("a column not in the database yet is skipped", async () => {
    const root = setup("tables:\n  tasks:\n    values:\n      status: [todo]\n", { "tasks/a.yaml": "title: A\n" });
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "tasks")).toEqual([]);
    await y.close();
  });

  test("a value written in SQL is checked like one from YAML", async () => {
    const root = setup("tables:\n  tasks:\n    values:\n      status: [todo, done]\n", {
      "tasks/a.yaml": "status: todo\n",
    });
    const y = await open({ root });
    await y.sync();
    sql(join(root, ".yamlite", "db.sqlite"), "UPDATE tasks SET status = 'later' WHERE id = 'a'");
    expect(warningsOf(await y.sync(), "tasks")).toEqual(['status "later" not in values (a)']);
    await y.close();
  });

  test("more than ten warnings are cut short", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`tasks/t${i}.yaml`] = `status: s${i}\n`;
    const root = setup("tables:\n  tasks:\n    values:\n      status: [todo]\n", files);
    const y = await open({ root });
    const warnings = warningsOf(await y.sync(), "tasks");
    expect(warnings).toHaveLength(11);
    expect(warnings[10]).toBe("… and 2 more value warnings");
    await y.close();
  });

  test("watch re-checks a table after its file changes", async () => {
    const root = setup("tables:\n  tasks:\n    values:\n      status: [todo, done]\n", {
      "tasks/a.yaml": "status: todo\n",
    });
    const y = await open({ root });
    const seen: string[][] = [];
    const watcher = y.watch({ onSync: (r) => seen.push(r.warnings) });
    await watcher.ready;
    write(join(root, "tasks/a.yaml"), "status: doen\n");
    await waitFor(() => seen.some((w) => w.includes('status "doen" not in values (a)')));
    seen.length = 0;
    write(join(root, "tasks/a.yaml"), "status: done\n");
    await waitFor(() => seen.length > 0 && seen.at(-1)?.length === 0);
    await y.close();
  });
});
