import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { runSteps, validateSteps } from "../../src/git/steps.ts";
import { read, tmpRoot, write } from "../helpers.ts";
import { commit, git, useGitEnv } from "../gitrepo.ts";
import { noop, setup } from "./helpers.ts";

beforeEach(() => useGitEnv());

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
