import { beforeEach, expect, test } from "vitest";
import type { GitDriver, GitStatus } from "../../src/git/driver.ts";
import { join } from "node:path";
import { useGitEnv, withRemote } from "../gitrepo.ts";
import { write } from "../helpers.ts";
import { tasksWorkspace } from "./helpers.ts";

beforeEach(() => useGitEnv());

function fakeDriver(files: Record<string, string>, changes: GitStatus): GitDriver {
  return {
    repo: null,
    steps: false,
    hasRemote: async () => true,
    status: async () => changes,
    defaultBranch: async () => "main",
    baseContent: async (p) => files[p] ?? null,
    history: async () => ({ state: "ok", entries: [], next: null }),
    fileDiff: async () => ({ state: "missing" }),
    remoteEnv: async () => ({}),
    author: async () => null,
    findOpenPr: async () => null,
    openPr: async () => ({ url: "https://example.test/pr/1", created: true }),
    review: async () => ({ branch: "b", steps: [], results: [], url: null, created: false }),
  };
}

test("a driver without a repository on disk serves the git routes", async () => {
  const git = fakeDriver(
    { "tasks/a.yaml": "title: A\n" },
    {
      branch: "main",
      upstream: null,
      changes: [{ path: "tasks/a.yaml", status: "modified" }],
    },
  );
  const { w: ws, root } = await tasksWorkspace({ git });
  write(join(root, "tasks/a.yaml"), "title: B\n");
  const body = await (await ws.router.dispatch(new Request("http://x/api/git"))).json();
  expect(body.git.changes).toEqual([
    {
      path: "tasks/a.yaml",
      status: "modified",
      table: "tasks",
      records: [{ key: "a", kind: "modified", fields: ["title"] }],
    },
  ]);
});

test("git: null answers no git and never runs git", async () => {
  const { w: ws } = await tasksWorkspace({ git: null }, (root) => void withRemote(root));
  expect(await (await ws.router.dispatch(new Request("http://x/api/git"))).json()).toEqual({ git: null });
  const h = await (await ws.router.dispatch(new Request("http://x/api/tables/tasks/rows/a/history"))).json();
  expect(h.state).toBe("nogit");
});
