import { beforeEach, expect, test } from "vitest";
import type { GitStatus, ReviewCapability, WorkspaceDriver } from "../../src/git/driver.ts";
import { join } from "node:path";
import { useGitEnv, withRemote } from "../gitrepo.ts";
import { read, write } from "../helpers.ts";
import { tasksWorkspace } from "./helpers.ts";

beforeEach(() => useGitEnv());

function fakeDriver(
  files: Record<string, string>,
  changes: GitStatus,
  review: Partial<ReviewCapability> = {},
): WorkspaceDriver {
  return {
    status: async () => changes,
    baseContent: async (p) => files[p] ?? null,
    baseFile: async (p) => (files[p] === undefined ? null : Buffer.from(files[p])),
    history: async () => ({ state: "ok", entries: [], next: null }),
    fileDiff: async () => ({ state: "missing" }),
    review: {
      available: async () => true,
      defaultBranch: async () => "main",
      review: async () => ({ branch: "b", steps: [], results: [], url: null, created: false }),
      ...review,
    },
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
  const { w: taking } = await tasksWorkspace({ git: fakeDriver({}, status, { namesBranch: true }) });
  expect((await (await taking.router.dispatch(new Request("http://x/api/git"))).json()).git.namesBranch).toBe(true);
  expect((await send(taking, "fix/tasks")).status).toBe(200);
});

test("a driver that cannot read the default branch offers no restore", async () => {
  const status = { branch: "review", upstream: null, changes: [] };
  const { w } = await tasksWorkspace({ git: fakeDriver({}, status) });
  const get = async (path: string, init?: RequestInit) => w.router.dispatch(new Request(`http://x${path}`, init));
  expect((await (await get("/api/git")).json()).git.restoresDefault).toBe(false);
  expect((await get("/api/git/default")).status).toBe(404);
  const post = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: ["tasks/a.yaml"] }),
  };
  expect((await get("/api/git/restore-default", post)).status).toBe(404);
});

test("a host's default branch files are listed and written back", async () => {
  const defaults: Record<string, string> = { "tasks/a.yaml": "title: A\n" };
  const git = fakeDriver(
    { "tasks/a.yaml": "title: B\n" },
    { branch: "review", upstream: null, changes: [] },
    {
      defaultBranchFiles: {
        changes: async () => [{ path: "tasks/a.yaml", status: "modified" }],
        file: async (p) => (defaults[p] === undefined ? null : Buffer.from(defaults[p])),
      },
    },
  );
  const { w, root } = await tasksWorkspace({ git });
  write(join(root, "tasks/a.yaml"), "title: B\n");
  const get = async (path: string, init?: RequestInit) => w.router.dispatch(new Request(`http://x${path}`, init));
  expect((await (await get("/api/git")).json()).git.restoresDefault).toBe(true);
  expect((await (await get("/api/git/default")).json()).files).toEqual([
    { path: "tasks/a.yaml", status: "modified", table: "tasks", unsent: false },
  ]);
  const r = await get("/api/git/restore-default", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: ["tasks/a.yaml"] }),
  });
  expect(r.status).toBe(200);
  expect(read(join(root, "tasks/a.yaml"))).toBe("title: A\n");
});

test("a driver without review answers no git footer", async () => {
  const { review: _, ...git } = fakeDriver({}, { branch: "main", upstream: null, changes: [] });
  const { w } = await tasksWorkspace({ git });
  expect(await (await w.router.dispatch(new Request("http://x/api/git"))).json()).toEqual({ git: null });
  const sent = await w.router.dispatch(
    new Request("http://x/api/git/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "T", paths: ["tasks/a.yaml"] }),
    }),
  );
  expect(sent.status).toBe(404);
});

test("a driver without history answers nogit", async () => {
  const { history: _h, fileDiff: _d, ...git } = fakeDriver({}, { branch: "main", upstream: null, changes: [] });
  const { w } = await tasksWorkspace({ git });
  const h = await (await w.router.dispatch(new Request("http://x/api/tables/tasks/rows/a/history"))).json();
  expect(h.state).toBe("nogit");
  const diff = await w.router.dispatch(new Request(`http://x/api/tables/tasks/rows/a/history/${"a".repeat(40)}/diff`));
  expect(diff.status).toBe(404);
});
