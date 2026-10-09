import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { localDriver, NoRepository, ReviewRefused } from "../../src/git/driver.ts";
import { findOpenPr } from "../../src/git/pr.ts";
import { findRepo } from "../../src/git/repo.ts";
import { commit, git, initRepo, useGitEnv, withRemote } from "../gitrepo.ts";
import { dataRoot, tmpRoot } from "../helpers.ts";

beforeEach(() => useGitEnv());

const fakeGh = (script: string) => {
  const path = join(tmpRoot(), "gh");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
};

test("a null default branch is asked for again, a found one is kept", async () => {
  const root = dataRoot();
  initRepo(root);
  commit(root, "init");
  const d = await localDriver(root, async () => null);
  expect(await d.defaultBranch()).toBeNull();
  const bare = tmpRoot();
  git(bare, "init", "-q", "--bare", "-b", "main");
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "-q", "-u", "origin", "main");
  git(root, "remote", "set-head", "origin", "main");
  expect(await d.defaultBranch()).toBe("main");
  git(root, "remote", "remove", "origin");
  expect(await d.defaultBranch()).toBe("main");
});

test("without gh, findOpenPr is null", async () => {
  const root = dataRoot();
  withRemote(root);
  expect(await findOpenPr((await findRepo(root))!, "work", null)).toBeNull();
});

test("with gh, findOpenPr returns an open PR's URL and ignores closed ones", async () => {
  const root = dataRoot();
  withRemote(root);
  const repo = (await findRepo(root))!;
  const open = fakeGh(`echo '{"url":"https://github.com/acme/notes/pull/7","state":"OPEN"}'`);
  expect(await findOpenPr(repo, "work", open)).toBe("https://github.com/acme/notes/pull/7");
  const closed = fakeGh(`echo '{"url":"https://github.com/acme/notes/pull/7","state":"CLOSED"}'`);
  expect(await findOpenPr(repo, "work", closed)).toBeNull();
});

test("the local driver offers git steps and refuses a review target", async () => {
  const root = dataRoot();
  withRemote(root);
  const repo = (await findRepo(root))!;
  const d = await localDriver(root, async () => null);
  expect(d.steps?.repo).toEqual(repo);
  await expect(
    d.review({ title: "T", body: "", paths: ["tasks/a.yaml"], target: "work" }, { afterTreeChange: async () => {} }),
  ).rejects.toEqual(new ReviewRefused(400, "this server cannot add to an existing pull request"));
});

test("the local driver refuses a detached HEAD with 409", async () => {
  const root = dataRoot();
  withRemote(root);
  git(root, "switch", "-q", "--detach");
  const d = await localDriver(root, async () => null);
  await expect(
    d.review({ title: "T", body: "", paths: ["x.yaml"], target: null }, { afterTreeChange: async () => {} }),
  ).rejects.toMatchObject({ status: 409 });
});

test("without a repository the local driver answers no git, and finds one created later", async () => {
  const root = dataRoot();
  const d = await localDriver(root, async () => null);
  expect(d.steps).toBeUndefined();
  expect(await d.hasRemote()).toBe(false);
  expect(await d.status()).toEqual({ branch: null, upstream: null, changes: [] });
  expect(await d.defaultBranch()).toBeNull();
  await expect(d.baseContent("tasks/a.yaml")).rejects.toBeInstanceOf(NoRepository);
  await expect(
    d.review({ title: "T", body: "", paths: ["tasks/a.yaml"], target: null }, { afterTreeChange: async () => {} }),
  ).rejects.toBeInstanceOf(NoRepository);
  withRemote(root);
  expect(await d.hasRemote()).toBe(true);
  expect(d.steps?.repo).toEqual(await findRepo(root));
});
