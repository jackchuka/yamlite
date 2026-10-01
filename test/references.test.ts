import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveConfig } from "../src/config.ts";
import { open } from "../src/index.ts";
import { tmpRoot, waitFor, write } from "./helpers.ts";

function setup(config: string, files: Record<string, string>) {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), config);
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  return root;
}

const warningsOf = (results: Array<{ table: string; warnings: string[] }>, table: string) =>
  results.find((r) => r.table === table)?.warnings ?? [];

describe("references", () => {
  test("missing targets are warnings; data still syncs", async () => {
    const root = setup("tables:\n  tasks:\n    references:\n      assignee: people\n", {
      "people.yaml": "- id: 1\n  name: Ann\n- id: 2\n  name: Bob\n",
      "tasks/a.yaml": "title: A\nassignee: 1\n",
      "tasks/b.yaml": "title: B\nassignee: 9\n",
      "tasks/c.yaml": "title: C\nassignee: 9\n",
      "tasks/d.yaml": "title: D\n",
    });
    const y = await open({ root });
    const results = await y.sync();
    expect(results.find((r) => r.table === "tasks")).toMatchObject({ ok: true, toDb: 4 });
    expect(warningsOf(results, "tasks")).toEqual(['assignee "9" not found in people.id (b, c)']);
    expect(warningsOf(await y.status(), "tasks")).toEqual(['assignee "9" not found in people.id (b, c)']);
    await y.close();
  });

  test("an explicit target column, text/integer matching and list values", async () => {
    const root = setup(
      "tables:\n  tasks:\n    references:\n      owner: people.slug\n      reviewers: people.slug\n      team: teams\n",
      {
        "people.yaml": "- id: 1\n  slug: ann\n",
        "teams.yaml": "- id: 7\n",
        "tasks/a.yaml": "owner: ann\nreviewers: [ann, zed]\nteam: '7'\n",
      },
    );
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "tasks")).toEqual(['reviewers "zed" not found in people.slug (a)']);
    await y.close();
  });

  test("a reference to an unknown table or column is reported", async () => {
    const root = setup("tables:\n  tasks:\n    references:\n      owner: ghosts\n      team: people.nope\n", {
      "people.yaml": "- id: 1\n",
      "tasks/a.yaml": "owner: x\nteam: y\n",
    });
    const y = await open({ root });
    expect(warningsOf(await y.sync(), "tasks")).toEqual([
      'references.owner: table "ghosts" is not in yamlite.yaml',
      'references.team: column "nope" not found in people',
    ]);
    await y.close();
  });

  test("rejects malformed declarations", () => {
    const root = setup("tables:\n  tasks:\n    references:\n      owner: a.b.c\n", { "tasks/a.yaml": "x: 1\n" });
    expect(() => resolveConfig({ root })).toThrow(/references.owner must be "table" or "table.column"/);
  });

  test("watch re-checks referrers when the referenced table changes", async () => {
    const root = setup("tables:\n  tasks:\n    references:\n      assignee: people\n", {
      "people.yaml": "- id: 1\n  name: Ann\n",
      "tasks/a.yaml": "title: A\nassignee: 1\n",
    });
    const y = await open({ root });
    const seen: string[] = [];
    const w = y.watch(
      { onSync: (r) => r.table === "tasks" && seen.push(...r.warnings) },
      { pollMs: 50, debounceMs: 50 },
    );
    await w.ready;
    expect(seen).toEqual([]);
    write(join(root, "people.yaml"), "- id: 2\n  name: Bob\n");
    await waitFor(() => seen.includes('assignee "1" not found in people.id (a)'));
    await y.close();
  });
});
