import { join, resolve } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  findRepo,
  gitBranches,
  gitDiff,
  gitLog,
  gitStatus,
  insideRoot,
  defaultBranch,
  runGit,
  GitError,
} from "../../src/git/repo.ts";
import { dataRoot, tmpRoot, write } from "../helpers.ts";
import { commit, git, useGitEnv, withRemote } from "../gitrepo.ts";

beforeEach(() => useGitEnv());

test("findRepo is null outside a work tree and gives the prefix inside one", async () => {
  expect(await findRepo(dataRoot())).toBeNull();
  const top = tmpRoot();
  withRemote(top);
  write(join(top, "data/yamlite.yaml"), "tables: {}\n");
  const repo = await findRepo(join(top, "data"));
  expect(repo).toMatchObject({ prefix: "data/" });
});

test("status lists only changes under the data root, relative to it", async () => {
  const top = tmpRoot();
  withRemote(top);
  write(join(top, "data/tasks/a.yaml"), "title: A\n");
  write(join(top, "other.txt"), "x");
  const repo = (await findRepo(join(top, "data")))!;
  const s = await gitStatus(repo);
  expect(s).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 0, behind: 0 });
  expect(s.changes).toEqual([{ path: "tasks/a.yaml", status: "??" }]);
});

test("diff, log, branches and the default branch", async () => {
  const root = dataRoot();
  withRemote(root);
  write(join(root, "tasks/a.yaml"), "title: A\n");
  commit(root, "add a");
  write(join(root, "tasks/a.yaml"), "title: B\n");
  git(root, "branch", "feature");
  const repo = (await findRepo(root))!;
  expect((await gitDiff(repo, ["tasks/a.yaml"])).diff).toContain("+title: B");
  expect((await gitLog(repo, 1)).map((c) => c.subject)).toEqual(["add a"]);
  expect(await gitBranches(repo)).toEqual({ current: "main", local: ["feature", "main"], defaultBranch: "main" });
  expect(await defaultBranch(repo)).toBe("main");
});

test("diff is capped", async () => {
  const root = dataRoot();
  withRemote(root);
  write(join(root, "big.yaml"), "x: 1\n");
  commit(root, "big");
  write(join(root, "big.yaml"), `x: "${"あ".repeat(100_000)}"\n`);
  const d = await gitDiff((await findRepo(root))!);
  expect(d.truncated).toBe(true);
  expect(Buffer.byteLength(d.diff)).toBeLessThanOrEqual(100_000);
  expect(d.diff).not.toContain("\uFFFD");
});

test("runGit rejects with the first stderr line", async () => {
  await expect(runGit(tmpRoot(), ["rev-parse", "HEAD"])).rejects.toThrow(GitError);
});

test("status keeps dotted branch names, counts ahead and reports a detached head", async () => {
  const root = dataRoot();
  withRemote(root);
  git(root, "checkout", "-q", "-b", "release-1.2");
  git(root, "push", "-q", "-u", "origin", "release-1.2");
  const repo = (await findRepo(root))!;
  expect(await gitStatus(repo)).toMatchObject({ branch: "release-1.2", upstream: "origin/release-1.2", ahead: 0 });
  write(join(root, "a.yaml"), "a: 1\n");
  commit(root, "local");
  expect(await gitStatus(repo)).toMatchObject({ branch: "release-1.2", ahead: 1, behind: 0 });
  git(root, "checkout", "-q", "--detach");
  expect(await gitStatus(repo)).toMatchObject({ branch: null, upstream: null });
});

test("status marks a worktree-only modification as ' M'", async () => {
  const root = dataRoot();
  withRemote(root);
  write(join(root, "yamlite.yaml"), "tables: {a: 1}\n");
  const s = await gitStatus((await findRepo(root))!);
  expect(s.changes).toEqual([{ path: "yamlite.yaml", status: " M" }]);
});

test("insideRoot maps paths under the data root and rejects the rest", () => {
  const top = tmpRoot();
  const r = { top, root: join(top, "data"), prefix: "data/" };
  expect(insideRoot(r, "tasks/a.yaml")).toBe("data/tasks/a.yaml");
  expect(insideRoot(r, "../x")).toBeNull();
  expect(insideRoot(r, resolve("/etc/passwd"))).toBeNull();
  expect(insideRoot(r, "..foo")).toBe("data/..foo");
  expect(insideRoot(r, "")).toBeNull();
  expect(insideRoot(r, ".")).toBeNull();
});

test("diff cannot reach a file outside the data folder", async () => {
  const top = tmpRoot();
  withRemote(top);
  write(join(top, "data/yamlite.yaml"), "tables: {}\n");
  write(join(top, "secret.txt"), "a\n");
  commit(top, "files");
  write(join(top, "secret.txt"), "b\n");
  const repo = (await findRepo(join(top, "data")))!;
  await expect(gitDiff(repo, ["../secret.txt"])).rejects.toThrow("../secret.txt must be inside the data folder");
  await expect(gitDiff(repo, ["tasks/../../secret.txt"])).rejects.toThrow(/inside the data folder/);
});
