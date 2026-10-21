import { beforeEach, expect, test } from "vitest";
import type { GitDriver, GitStatus } from "../../src/git/driver.ts";
import { join } from "node:path";
import { useGitEnv, withRemote } from "../gitrepo.ts";
import { write } from "../helpers.ts";
import { tasksWorkspace } from "./helpers.ts";

beforeEach(() => useGitEnv());

function fakeDriver(files: Record<string, string>, changes: GitStatus): GitDriver {
  return {
    hasRemote: async () => true,
    status: async () => changes,
    defaultBranch: async () => "main",
    baseContent: async (p) => files[p] ?? null,
    baseFile: async (p) => (files[p] === undefined ? null : Buffer.from(files[p])),
    history: async () => ({ state: "ok", entries: [], next: null }),
    fileDiff: async () => ({ state: "missing" }),
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

test("a branch name for a review goes only to a host that takes one", async () => {
  const status = { branch: "main", upstream: null, changes: [{ path: "tasks/a.yaml", status: "modified" as const }] };
  const send = (ws: { router: { dispatch(r: Request): Promise<Response> } }, branch?: string) =>
    ws.router.dispatch(
      new Request("http://x/api/git/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "T", paths: ["tasks/a.yaml"], ...(branch ? { branch } : {}) }),
      }),
    );
  const names = fakeDriver({}, status);
  const { w: own } = await tasksWorkspace({ git: names });
  expect((await (await own.router.dispatch(new Request("http://x/api/git"))).json()).git.namesBranch).toBe(false);
  const refused = await send(own, "fix/tasks");
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ field: "branch" });
  expect((await send(own)).status).toBe(200);
  const { w: taking } = await tasksWorkspace({ git: { ...fakeDriver({}, status), namesBranch: true } });
  expect((await (await taking.router.dispatch(new Request("http://x/api/git"))).json()).git.namesBranch).toBe(true);
  expect((await send(taking, "fix/tasks")).status).toBe(200);
});
