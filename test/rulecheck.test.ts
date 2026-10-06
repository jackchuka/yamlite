import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, open } from "../src/index.ts";
import { sql, tmpRoot, waitFor, write } from "./helpers.ts";

function setup(config: string, files: Record<string, string>) {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), config);
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  return root;
}

const warningsOf = (results: Array<{ table: string; warnings: string[] }>, table: string) =>
  results.find((r) => r.table === table)?.warnings ?? [];

describe("formats", () => {
  test("a value that is not a date or datetime is a warning; data still syncs", async () => {
    const root = setup("tables:\n  tasks:\n    formats: { due: date, at: datetime }\n", {
      "tasks/a.yaml": "due: 2026-10-06\nat: 2026-10-06T09:00+09:00\n",
      "tasks/b.yaml": "due: 2026-02-31\nat: yesterday\n",
      "tasks/c.yaml": "due: 2026-02-31\n",
    });
    const y = await open({ root });
    const results = await y.sync();
    expect(results.find((r) => r.table === "tasks")).toMatchObject({ ok: true, toDb: 3 });
    expect(warningsOf(results, "tasks")).toEqual([
      'due "2026-02-31" not a date (b, c)',
      'at "yesterday" not a datetime (b)',
    ]);
    await y.close();
  });

  test("expanded views are checked, with the view's name in front", async () => {
    const root = setup("tables:\n  projects:\n    expand:\n      milestones:\n        formats: { due: date }\n", {
      "projects/release.yaml": "milestones:\n  - due: 2026-10-01\n  - due: soon\n",
    });
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "projects")).toEqual(['projects__milestones: due "soon" not a date (release/1)']);
    await y.close();
  });

  test("more than ten warnings are cut", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`tasks/t${i}.yaml`] = `due: bad-${i}\n`;
    const root = setup("tables:\n  tasks:\n    formats: { due: date }\n", files);
    const y = await open({ root });
    const warnings = warningsOf(await y.sync(), "tasks");
    expect(warnings).toHaveLength(11);
    expect(warnings.at(-1)).toBe("… and 2 more format warnings");
    await y.close();
  });
});

describe("min and max", () => {
  test("a number outside its bounds is a warning; the bounds are included", async () => {
    const root = setup(
      "tables:\n  tasks:\n    columns: { priority: INTEGER, ratio: REAL }\n    min: { priority: 1, ratio: 0 }\n    max: { priority: 5, ratio: 1 }\n",
      {
        "tasks/a.yaml": "priority: 1\nratio: 1\n",
        "tasks/b.yaml": "priority: 5\nratio: 1.5\n",
        "tasks/c.yaml": "priority: 7\n",
        "tasks/d.yaml": "priority: 0\n",
      },
    );
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "tasks")).toEqual([
      "priority 0 below min 1 (d)",
      "priority 7 above max 5 (c)",
      "ratio 1.5 above max 1 (b)",
    ]);
    await y.close();
  });

  test("dates and datetimes compare as points in time; broken dates are left to the format check", async () => {
    const root = setup(
      "tables:\n  tasks:\n    formats: { due: date, at: datetime }\n    min: { due: 2026-01-01, at: 2026-01-01 }\n",
      {
        "tasks/a.yaml": "due: 2025-12-31\nat: 2026-01-01T08:00:00+09:00\n",
        "tasks/b.yaml": "due: 2026-01-01\nat: 2026-01-01T09:00:00+09:00\n",
        "tasks/c.yaml": "due: 2025-02-31\n",
      },
    );
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "tasks")).toEqual([
      'due "2025-02-31" not a date (c)',
      'due "2025-12-31" below min 2026-01-01 (a)',
      'at "2026-01-01T08:00:00+09:00" below min 2026-01-01 (a)',
    ]);
    await y.close();
  });

  test("a value written in SQL is checked like one from YAML", async () => {
    const root = setup("tables:\n  tasks:\n    columns: { priority: INTEGER }\n    max: { priority: 5 }\n", {
      "tasks/a.yaml": "priority: 2\n",
    });
    const y = await open({ root });
    await y.sync();
    sql(join(root, ".yamlite", "db.sqlite"), "UPDATE tasks SET priority = 9 WHERE id = 'a'");
    expect(warningsOf(await y.sync(), "tasks")).toEqual(["priority 9 above max 5 (a)"]);
    await y.close();
  });

  test("watch re-checks a table after its file changes", async () => {
    const root = setup("tables:\n  tasks:\n    columns: { priority: INTEGER }\n    max: { priority: 5 }\n", {
      "tasks/a.yaml": "priority: 2\n",
    });
    const y = await open({ root });
    const seen: string[][] = [];
    const watcher = y.watch({ onSync: (r) => seen.push(r.warnings) });
    await watcher.ready;
    write(join(root, "tasks/a.yaml"), "priority: 8\n");
    await waitFor(() => seen.some((w) => w.includes("priority 8 above max 5 (a)")));
    await y.close();
  });

  test("check fails on a range warning", async () => {
    const root = setup("tables:\n  tasks:\n    columns: { priority: INTEGER }\n    max: { priority: 5 }\n", {
      "tasks/a.yaml": "priority: 8\n",
    });
    const r = await check({ root });
    expect(r.ok).toBe(false);
    expect(r.tables[0]?.warnings).toEqual(["priority 8 above max 5 (a)"]);
  });

  test("expanded views are bound-checked, with the view's name in front", async () => {
    const root = setup(
      "tables:\n  projects:\n    expand:\n      milestones:\n        columns: { points: INTEGER }\n        max: { points: 13 }\n",
      { "projects/release.yaml": "milestones:\n  - points: 5\n  - points: 20\n" },
    );
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "projects")).toEqual([
      "projects__milestones: points 20 above max 13 (release/1)",
    ]);
    await y.close();
  });

  test("more than ten range warnings are cut", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`tasks/t${i}.yaml`] = `priority: ${10 + i}\n`;
    const root = setup("tables:\n  tasks:\n    columns: { priority: INTEGER }\n    max: { priority: 5 }\n", files);
    const y = await open({ root });
    const warnings = warningsOf(await y.sync(), "tasks");
    expect(warnings).toHaveLength(11);
    expect(warnings.at(-1)).toBe("… and 2 more range warnings");
    await y.close();
  });

  test("status reports format and range warnings", async () => {
    const root = setup(
      "tables:\n  tasks:\n    columns: { priority: INTEGER }\n    formats: { due: date }\n    max: { priority: 5 }\n",
      { "tasks/a.yaml": "priority: 8\ndue: soon\n" },
    );
    const y = await open({ root });
    await y.sync();
    expect(warningsOf(await y.status(), "tasks")).toEqual(['due "soon" not a date (a)', "priority 8 above max 5 (a)"]);
    await y.close();
  });

  test("a bound on a key column is checked", async () => {
    const root = setup("tables:\n  people:\n    columns: { id: INTEGER }\n    max: { id: 100 }\n", {
      "people.yaml": "- id: 1\n- id: 150\n",
    });
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "people")).toEqual(["id 150 above max 100 (150)"]);
    await y.close();
  });
});
