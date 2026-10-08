import { chmodSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { agentTools } from "../../src/agent/tools.ts";
import { localDriver } from "../../src/git/driver.ts";
import { findRepo } from "../../src/git/repo.ts";
import { commit, git, useGitEnv, withRemote } from "../gitrepo.ts";
import { dataRoot, read, sql, tmpRoot, waitFor, write } from "../helpers.ts";
import { type Served, startServe } from "./helpers.ts";

let t: Served | undefined;
beforeEach(() => useGitEnv());
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const TASKS = "tables:\n  tasks:\n    columns:\n      title: TEXT\n";

const call = (t: Served, name: string, args: Record<string, unknown> = {}) =>
  agentTools(t.s.context, "c1")
    .find((x) => x.name === name)!
    .call(args) as Promise<any>;

test("no git tools outside a repository", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, undefined, { gh: null });
  expect(t.s.context.git).toBeNull();
  expect(agentTools(t.s.context, "c1").map((x) => x.name)).not.toContain("git_status");
});

test("git_status and propose_git create a card; applying it pushes the branch", async () => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), TASKS);
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const bare = withRemote(root);
  t = await startServe({}, undefined, { root, gh: null });
  await t.api("/api/tables/tasks/rows/a", { method: "PATCH", body: { values: { title: "B" }, base: { title: "A" } } });
  expect((await call(t, "git_status")).changes).toEqual([{ path: "tasks/a.yaml", status: " M" }]);
  const out = await call(t, "propose_git", {
    title: "review a",
    steps: [
      { kind: "create_branch", name: "edit-a" },
      { kind: "commit", message: "edit a", paths: ["tasks/a.yaml"] },
      { kind: "push", branch: "edit-a" },
      { kind: "switch", branch: "main" },
    ],
  });
  expect(out).toMatch(/^Proposal p_\w+ created: 4 git steps/);
  const [p] = t.s.context.proposals.pending();
  const r = await t.api(`/api/agent/proposals/${p!.id}/apply`, { method: "POST" });
  expect(r.body.status).toBe("applied");
  expect(git(bare, "show", "edit-a:tasks/a.yaml")).toBe("title: B\n");
  expect(read(join(root, "tasks/a.yaml"))).toBe("title: A\n");
  expect(sql(t.db, "SELECT title FROM tasks")).toEqual([{ title: "A" }]);
});

test("propose_git rejects invalid steps without a card", async () => {
  const root = dataRoot();
  withRemote(root);
  t = await startServe({}, undefined, { root, gh: null });
  await expect(call(t, "propose_git", { title: "x", steps: [{ kind: "push", branch: "main" }] })).rejects.toThrow(
    /default branch/,
  );
  expect(t.s.context.proposals.pending()).toEqual([]);
});

test("switching branches syncs the database even past the deletion guard", async () => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), TASKS);
  write(join(root, "tasks/.gitkeep"), "");
  withRemote(root);
  git(root, "switch", "-q", "-c", "many");
  for (let i = 0; i < 30; i++) write(join(root, `tasks/t${i}.yaml`), `title: T${i}\n`);
  commit(root, "many");
  t = await startServe({}, undefined, { root, gh: null });
  await waitFor(() => sql(t!.db, "SELECT count(*) AS n FROM tasks")[0]?.n === 30);
  await call(t, "propose_git", { title: "back", steps: [{ kind: "switch", branch: "main" }] });
  const [p] = t.s.context.proposals.pending();
  expect((await t.api(`/api/agent/proposals/${p!.id}/apply`, { method: "POST" })).body.status).toBe("applied");
  expect(sql(t.db, "SELECT count(*) AS n FROM tasks")).toEqual([{ n: 0 }]);
});

test("steps do not run when the latest edits cannot be written to files", async () => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), TASKS);
  write(join(root, "tasks/a.yaml"), "title: A\n");
  withRemote(root);
  t = await startServe({}, undefined, { root, gh: null });
  await call(t, "propose_git", { title: "x", steps: [{ kind: "create_branch", name: "nope" }] });
  const [p] = t.s.context.proposals.pending();
  rmSync(join(root, "tasks"), { recursive: true });
  const r = await t.api(`/api/agent/proposals/${p!.id}/apply`, { method: "POST" });
  expect(JSON.stringify(r.body)).toMatch(/nothing was run/);
  expect(git(root, "branch", "--list", "nope")).toBe("");
});

test("a switch whose database sync fails is reported as failed", async () => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), TASKS);
  withRemote(root);
  git(root, "switch", "-q", "-c", "many");
  write(join(root, "tasks/a.yaml"), "title: A\n");
  commit(root, "many");
  t = await startServe({}, undefined, { root, gh: null });
  await waitFor(() => sql(t!.db, "SELECT count(*) AS n FROM tasks")[0]?.n === 1);
  await call(t, "propose_git", {
    title: "back",
    steps: [
      { kind: "switch", branch: "main" },
      { kind: "create_branch", name: "later" },
    ],
  });
  const [p] = t.s.context.proposals.pending();
  const r = await t.api(`/api/agent/proposals/${p!.id}/apply`, { method: "POST" });
  expect(r.body.status).toBe("failed");
  expect(r.body.git.results[0].message).toMatch(/^git succeeded but syncing the database failed/);
  expect(r.body.git.results[1].status).toBe("skipped");
  expect(git(root, "branch", "--show-current").trim()).toBe("main");
});

test("a card applied after the checked-out branch changed runs nothing", async () => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), TASKS);
  withRemote(root);
  t = await startServe({}, undefined, { root, gh: null });
  await call(t, "propose_git", { title: "x", steps: [{ kind: "create_branch", name: "nope" }] });
  const [p] = t.s.context.proposals.pending();
  git(root, "switch", "-q", "-c", "elsewhere");
  const r = await t.api(`/api/agent/proposals/${p!.id}/apply`, { method: "POST" });
  expect(r.body.status).toBe("failed");
  expect(r.body.git.results[0].message).toMatch(/changed from main to elsewhere/);
  expect(git(root, "branch", "--list", "nope")).toBe("");
});

test("gh is not probed when the agent is off", async () => {
  const root = dataRoot();
  withRemote(root);
  const dir = tmpRoot();
  const log = join(dir, "gh.log");
  write(join(dir, "gh"), `#!/bin/sh\necho called >> ${log}\n`);
  chmodSync(join(dir, "gh"), 0o755);
  vi.stubEnv("PATH", `${dir}:${process.env.PATH}`);
  t = await startServe({}, undefined, { root, agent: false });
  expect(existsSync(log)).toBe(false);
});

test("a finished git proposal starts an agent turn that reports the result without a user message", async () => {
  const scenario = join(tmpRoot(), "scenario.json");
  write(
    scenario,
    JSON.stringify([
      [{ mcp: "propose_git", args: { title: "branch", steps: [{ kind: "create_branch", name: "edit-a" }] } }],
      [{ echo: true }],
    ]),
  );
  vi.stubEnv("FAKE_AGENT_SCENARIO", scenario);
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), TASKS);
  write(join(root, "tasks/a.yaml"), "title: A\n");
  withRemote(root);
  const fake = join(import.meta.dirname, "../fixtures/fake-agent.mjs");
  t = await startServe({}, undefined, {
    root,
    gh: null,
    agents: [{ id: "test", name: "Test agent", command: process.execPath, args: [fake], login: "login" }],
  });
  const host = t.s.context.agent!;
  const c = await host.start("test");
  host.prompt(c.id, "make a branch");
  await waitFor(() => !c.busy && c.events.some((e) => e.type === "proposal"));
  const [p] = t.s.context.proposals.pending();
  expect((await t.api(`/api/agent/proposals/${p!.id}/apply`, { method: "POST" })).body.status).toBe("applied");
  await waitFor(() => c.events.some((e) => e.type === "text" && /all git steps ran/.test(e.text)));
  expect(c.events.filter((e) => e.type === "user")).toHaveLength(1);
}, 30_000);

test("with git steps off there is no propose_git and git proposals cannot be applied", async () => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), TASKS);
  withRemote(root);
  t = await startServe({}, undefined, {
    root,
    gh: null,
    git: { ...localDriver((await findRepo(root))!, root, async () => null), steps: false },
  });
  const names = agentTools(t.s.context, "c1").map((x) => x.name);
  expect(names).toContain("git_status");
  expect(names).not.toContain("propose_git");
  // a card made before the switch (or by an agent with a stale tool list) must not run
  const p = t.s.context.proposals.forGit("c1", "x", [{ kind: "create_branch", name: "edit-a" }], "main");
  expect((await t.api(`/api/agent/proposals/${p.id}/apply`, { method: "POST" })).status).toBe(404);
});
