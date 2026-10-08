import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { findRepo } from "../../src/git/repo.ts";
import { runSteps, validateSteps } from "../../src/git/steps.ts";
import { dataRoot, read, tmpRoot, write } from "../helpers.ts";
import { commit, git, useGitEnv, withRemote } from "../gitrepo.ts";

beforeEach(() => useGitEnv());

async function setup() {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const bare = withRemote(root);
  const repo = (await findRepo(root))!;
  return { root, bare, repo };
}
const noop = { gh: null, expectBranch: "main", afterTreeChange: async () => {} };

test("branch → commit → push → switch back", async () => {
  const { root, bare, repo } = await setup();
  write(join(root, "tasks/a.yaml"), "title: B\n");
  write(join(root, "tasks/new.yaml"), "title: N\n");
  const { steps } = await validateSteps(repo, [
    { kind: "create_branch", name: "edit-a" },
    { kind: "commit", message: "edit a", paths: ["tasks/a.yaml"] },
    { kind: "push", branch: "edit-a" },
    { kind: "switch", branch: "main" },
  ]);
  let synced = 0;
  const results = await runSteps(repo, steps, { ...noop, afterTreeChange: async () => void synced++ });
  expect(results.map((r) => r.status)).toEqual(["done", "done", "done", "done"]);
  expect(git(bare, "show", "edit-a:tasks/a.yaml")).toBe("title: B\n");
  expect(git(bare, "show", "--stat", "--format=%s", "edit-a")).not.toContain("new.yaml");
  expect(read(join(root, "tasks/a.yaml"))).toBe("title: A\n");
  // the uncommitted file is carried over to main
  expect(existsSync(join(root, "tasks/new.yaml"))).toBe(true);
  expect(synced).toBe(1);
});

test("commit of a deleted tracked file records the deletion", async () => {
  const { root, bare, repo } = await setup();
  rmSync(join(root, "tasks/a.yaml"));
  const { steps } = await validateSteps(repo, [
    { kind: "create_branch", name: "drop-a" },
    { kind: "commit", message: "drop a", paths: ["tasks/a.yaml"] },
    { kind: "push", branch: "drop-a" },
  ]);
  expect((await runSteps(repo, steps, noop)).map((r) => r.status)).toEqual(["done", "done", "done"]);
  expect(() =>
    execFileSync("git", ["cat-file", "-e", "drop-a:tasks/a.yaml"], { cwd: bare, stdio: "ignore" }),
  ).toThrow();
});

test("a conflicting uncommitted change stops the steps", async () => {
  const { root, repo } = await setup();
  git(root, "switch", "-q", "-c", "other");
  write(join(root, "tasks/a.yaml"), "title: OTHER\n");
  commit(root, "other");
  git(root, "switch", "-q", "main");
  write(join(root, "tasks/a.yaml"), "title: LOCAL\n");
  const { steps } = await validateSteps(repo, [
    { kind: "switch", branch: "other" },
    { kind: "commit", message: "x", paths: ["tasks/a.yaml"] },
  ]);
  const results = await runSteps(repo, steps, noop);
  expect(results[0]).toMatchObject({ status: "failed" });
  expect(results[0]?.message).toMatch(/overwritten|local changes/);
  expect(results[1]).toEqual({ status: "skipped" });
  expect(read(join(root, "tasks/a.yaml"))).toBe("title: LOCAL\n");
});

test("push to an unreachable remote fails without prompting", async () => {
  const { root, repo } = await setup();
  git(root, "remote", "set-url", "origin", "https://127.0.0.1:9/none.git");
  const { steps } = await validateSteps(repo, [
    { kind: "create_branch", name: "x" },
    { kind: "push", branch: "x" },
  ]);
  const started = Date.now();
  const results = await runSteps(repo, steps, noop);
  expect(results[1]?.status).toBe("failed");
  expect(Date.now() - started).toBeLessThan(20_000);
});

test.each([
  [[{ kind: "reset", to: "HEAD" }], /unknown step/],
  [[{ kind: "commit", message: "m", paths: ["../outside.yaml"] }], /inside the data folder/],
  [[{ kind: "commit", message: "m", paths: ["/etc/passwd"] }], /inside the data folder/],
  [[{ kind: "commit", message: "m", paths: ["tasks/missing.yaml"] }], /no such file/],
  [[{ kind: "commit", message: "", paths: ["tasks/a.yaml"] }], /message/],
  [[{ kind: "create_branch", name: "bad..name" }], /branch name/],
  [[{ kind: "push", branch: "main" }], /default branch/],
  [
    [
      { kind: "create_branch", name: "x" },
      { kind: "open_pr", title: "t", body: "" },
    ],
    /push/,
  ],
  [[{ kind: "push", branch: "+main" }], /branch name/],
  [[{ kind: "push", branch: "+feat" }], /branch name/],
  [[{ kind: "push", branch: "refs/heads/main" }], /branch name/],
  [[{ kind: "push", branch: "heads/main" }], /branch name/],
  [[{ kind: "push", branch: "@" }], /branch name/],
  [[{ kind: "push", branch: "-x" }], /branch name/],
  [[{ kind: "push", branch: "ghost" }], /does not exist/],
  [[], /at least one step/],
])("validation rejects %j", async (steps, err) => {
  const { repo } = await setup();
  await expect(validateSteps(repo, steps)).rejects.toThrow(err);
});

test("open_pr returns the PR URL and uses the default branch as base", async () => {
  const { root, bare, repo } = await setup();
  git(root, "remote", "set-url", "--add", "--push", "origin", bare);
  git(root, "remote", "set-url", "origin", "git@github.com:o/r.git");
  write(join(root, "tasks/a.yaml"), "title: B\n");
  const { steps } = await validateSteps(repo, [
    { kind: "create_branch", name: "edit-a" },
    { kind: "commit", message: "edit a", paths: ["tasks/a.yaml"] },
    { kind: "push", branch: "edit-a" },
    { kind: "open_pr", title: "Edit A", body: "why" },
  ]);
  const results = await runSteps(repo, steps, noop);
  expect(results[3]).toEqual({
    status: "done",
    url: "https://github.com/o/r/compare/main...edit-a?quick_pull=1&title=Edit%20A&body=why",
    created: false,
  });
});

test("push is refused when the remote default branch is unknown", async () => {
  const { root, repo } = await setup();
  git(root, "remote", "set-url", "origin", "https://127.0.0.1:9/none.git");
  git(root, "remote", "set-head", "origin", "-d");
  await expect(
    validateSteps(repo, [
      { kind: "create_branch", name: "x" },
      { kind: "push", branch: "x" },
    ]),
  ).rejects.toThrow(/default branch/);
});

test("pull fast-forwards from the remote", async () => {
  const { root, bare, repo } = await setup();
  const other = tmpRoot();
  git(other, "clone", "-q", bare, "w");
  const w = join(other, "w");
  write(join(w, "tasks/a.yaml"), "title: REMOTE\n");
  commit(w, "remote edit");
  git(w, "push", "-q", "origin", "main");
  const { steps } = await validateSteps(repo, [{ kind: "pull", branch: "main" }]);
  let synced = 0;
  const results = await runSteps(repo, steps, { ...noop, afterTreeChange: async () => void synced++ });
  expect(results.map((r) => r.status)).toEqual(["done"]);
  expect(read(join(root, "tasks/a.yaml"))).toBe("title: REMOTE\n");
  expect(synced).toBe(1);
});

test("pull needs the branch checked out", async () => {
  const { repo } = await setup();
  await expect(validateSteps(repo, [{ kind: "pull", branch: "other" }])).rejects.toThrow(/checked out/);
});

test("create_branch from a base syncs the tree", async () => {
  const { repo } = await setup();
  const { steps } = await validateSteps(repo, [{ kind: "create_branch", name: "x", from: "main" }]);
  let synced = 0;
  await runSteps(repo, steps, { ...noop, afterTreeChange: async () => void synced++ });
  expect(synced).toBe(1);
});

test("a failed sync after git succeeded marks the step failed", async () => {
  const { root, repo } = await setup();
  const { steps } = await validateSteps(repo, [
    { kind: "create_branch", name: "x", from: "main" },
    { kind: "switch", branch: "main" },
  ]);
  const results = await runSteps(repo, steps, {
    ...noop,
    afterTreeChange: async () => {
      throw new Error("boom");
    },
  });
  expect(results[0]).toEqual({ status: "failed", message: "git succeeded but syncing the database failed: boom" });
  expect(results[1]).toEqual({ status: "skipped" });
  expect(git(root, "branch", "--show-current").trim()).toBe("x");
});

test("validation rejects a commit path that is only a pattern", async () => {
  const { repo } = await setup();
  await expect(validateSteps(repo, [{ kind: "commit", message: "m", paths: ["tasks/*"] }])).rejects.toThrow(
    /no such file/,
  );
});

test("a commit stages only the listed file, not an untracked neighbour", async () => {
  const { root, bare, repo } = await setup();
  write(join(root, "tasks/a.yaml"), "title: B\n");
  write(join(root, "tasks/key.env"), "SECRET=1\n");
  const { steps } = await validateSteps(repo, [
    { kind: "create_branch", name: "x" },
    { kind: "commit", message: "m", paths: ["tasks/a.yaml"] },
    { kind: "push", branch: "x" },
  ]);
  expect((await runSteps(repo, steps, noop)).map((r) => r.status)).toEqual(["done", "done", "done"]);
  expect(git(bare, "ls-tree", "-r", "--name-only", "x")).not.toContain("key.env");
});

test("nothing runs when the checked-out branch changed since validation", async () => {
  const { root, repo } = await setup();
  const { steps, startBranch } = await validateSteps(repo, [{ kind: "create_branch", name: "x" }]);
  expect(startBranch).toBe("main");
  git(root, "switch", "-q", "-c", "elsewhere");
  const results = await runSteps(repo, steps, { ...noop, expectBranch: startBranch });
  expect(results[0]).toEqual({
    status: "failed",
    message: "the checked-out branch changed from main to elsewhere since this was proposed; nothing was run",
  });
  expect(git(root, "branch", "--list", "x")).toBe("");
});
