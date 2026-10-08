import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { localDriver, ReviewRefused } from "../../src/git/driver.ts";
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

test("the local driver adds nothing to the env and keeps git's author", async () => {
  const root = dataRoot();
  initRepo(root);
  const d = localDriver((await findRepo(root))!, root, async () => null);
  expect(await d.remoteEnv()).toEqual({});
  expect(await d.author()).toBeNull();
});

test("a null default branch is asked for again, a found one is kept", async () => {
  const root = dataRoot();
  initRepo(root);
  commit(root, "init");
  const d = localDriver((await findRepo(root))!, root, async () => null);
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

test("without gh, findOpenPr is null and openPr gives the compare link", async () => {
  const root = dataRoot();
  withRemote(root);
  git(root, "remote", "set-url", "origin", "https://github.com/acme/notes.git");
  const repo = (await findRepo(root))!;
  const d = localDriver(repo, root, async () => null);
  expect(await d.findOpenPr("work")).toBeNull();
  const pr = await d.openPr({ base: "main", head: "work", title: "T", body: "B" });
  expect(pr).toEqual({
    url: expect.stringMatching(/^https:\/\/github\.com\/acme\/notes\/compare\/main\.\.\.work\?/),
    created: false,
  });
});

test("with gh, findOpenPr returns an open PR's URL and ignores closed ones", async () => {
  const root = dataRoot();
  withRemote(root);
  const repo = (await findRepo(root))!;
  const open = fakeGh(`echo '{"url":"https://github.com/acme/notes/pull/7","state":"OPEN"}'`);
  expect(await localDriver(repo, root, async () => open).findOpenPr("work")).toBe(
    "https://github.com/acme/notes/pull/7",
  );
  const closed = fakeGh(`echo '{"url":"https://github.com/acme/notes/pull/7","state":"CLOSED"}'`);
  expect(await localDriver(repo, root, async () => closed).findOpenPr("work")).toBeNull();
});

test("the local driver offers git steps and refuses a review target", async () => {
  const root = dataRoot();
  withRemote(root);
  const repo = (await findRepo(root))!;
  const d = localDriver(repo, root, async () => null);
  expect(d.steps).toBe(true);
  await expect(
    d.review({ title: "T", body: "", paths: ["tasks/a.yaml"], target: "work" }, { afterTreeChange: async () => {} }),
  ).rejects.toEqual(new ReviewRefused(400, "this server cannot add to an existing pull request"));
});

test("the local driver refuses a detached HEAD with 409", async () => {
  const root = dataRoot();
  withRemote(root);
  git(root, "switch", "-q", "--detach");
  const repo = (await findRepo(root))!;
  await expect(
    localDriver(repo, root, async () => null).review(
      { title: "T", body: "", paths: ["x.yaml"], target: null },
      { afterTreeChange: async () => {} },
    ),
  ).rejects.toMatchObject({ status: 409 });
});
