import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { GitDriver } from "./driver.ts";
import { currentBranch, defaultBranch, GitError, insideRoot, type Repo, runGit, SLOW_MS } from "./repo.ts";

export type GitStep =
  | { kind: "create_branch"; name: string; from?: string }
  | { kind: "switch"; branch: string }
  | { kind: "commit"; message: string; paths: string[] }
  | { kind: "push"; branch: string }
  | { kind: "pull"; branch: string }
  | { kind: "open_pr"; title: string; body: string; base?: string };

export interface StepResult {
  status: "done" | "failed" | "skipped";
  message?: string;
  url?: string;
  created?: boolean;
}

export const STEP_KINDS = ["create_branch", "switch", "commit", "push", "pull", "open_pr"] as const;

export const changesTree = (s: GitStep): boolean =>
  s.kind === "switch" || s.kind === "pull" || (s.kind === "create_branch" && s.from !== undefined);

const text = (v: unknown, name: string, i: number, empty = false): string => {
  if (typeof v !== "string" || (!empty && v.trim() === "")) throw new Error(`step ${i + 1}: ${name} is required`);
  return v;
};

async function branchName(repo: Repo, v: unknown, i: number): Promise<string> {
  const name = text(v, "branch name", i);
  const invalid = () => new Error(`step ${i + 1}: "${name}" is not a valid branch name; use the plain short name`);
  if (/^[+-]/.test(name) || /^(refs|heads)\//.test(name) || name.includes("@")) throw invalid();
  try {
    return (await runGit(repo.top, ["check-ref-format", "--branch", name])).trim();
  } catch {
    throw invalid();
  }
}

async function commitPath(repo: Repo, v: unknown, i: number): Promise<string> {
  const p = text(v, "path", i);
  const top = insideRoot(repo, p);
  if (top === null) throw new Error(`step ${i + 1}: ${p} must be inside the data folder`);
  if (existsSync(resolve(repo.root, p))) return p;
  try {
    await runGit(repo.top, ["ls-files", "--error-unmatch", "--", top]);
    return p;
  } catch {
    throw new Error(`step ${i + 1}: no such file: ${p}`);
  }
}

async function localBranchExists(repo: Repo, branch: string): Promise<boolean> {
  try {
    await runGit(repo.top, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function hasUpstream(repo: Repo, branch: string): Promise<boolean> {
  try {
    await runGit(repo.top, ["rev-parse", "--verify", "-q", `${branch}@{upstream}`]);
    return true;
  } catch {
    return false;
  }
}

export async function validateSteps(
  repo: Repo,
  raw: unknown,
): Promise<{ steps: GitStep[]; startBranch: string | null }> {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("steps must hold at least one step");
  const base = await defaultBranch(repo);
  const startBranch = await currentBranch(repo);
  let current = startBranch;
  const pushed = new Set<string>();
  const created = new Set<string>();
  const steps: GitStep[] = [];
  for (const [i, r] of raw.entries()) {
    const s = (r ?? {}) as Record<string, unknown>;
    switch (s.kind) {
      case "create_branch": {
        const name = await branchName(repo, s.name, i);
        const from = s.from === undefined ? undefined : await branchName(repo, s.from, i);
        steps.push(from === undefined ? { kind: "create_branch", name } : { kind: "create_branch", name, from });
        current = name;
        created.add(name);
        break;
      }
      case "switch":
        current = await branchName(repo, s.branch, i);
        steps.push({ kind: "switch", branch: current });
        break;
      case "commit": {
        const message = text(s.message, "commit message", i);
        if (!Array.isArray(s.paths) || s.paths.length === 0) throw new Error(`step ${i + 1}: paths must list files`);
        const paths: string[] = [];
        for (const p of s.paths) paths.push(await commitPath(repo, p, i));
        steps.push({ kind: "commit", message, paths });
        break;
      }
      case "push": {
        const branch = await branchName(repo, s.branch, i);
        if (base === null) throw new Error(`step ${i + 1}: cannot tell the remote default branch; push refused`);
        if (branch === base)
          throw new Error(
            `step ${i + 1}: pushing to the default branch ${base} is not allowed; push a new branch and open a PR`,
          );
        if (!created.has(branch) && !(await localBranchExists(repo, branch)))
          throw new Error(`step ${i + 1}: branch ${branch} does not exist; create it first`);
        pushed.add(branch);
        steps.push({ kind: "push", branch });
        break;
      }
      case "pull": {
        const branch = await branchName(repo, s.branch, i);
        if (branch !== current) throw new Error(`step ${i + 1}: pull ${branch} needs ${branch} checked out first`);
        steps.push({ kind: "pull", branch });
        break;
      }
      case "open_pr": {
        if (current === null || (!pushed.has(current) && !(await hasUpstream(repo, current))))
          throw new Error(`step ${i + 1}: push the branch before open_pr`);
        const title = text(s.title, "title", i);
        const body = text(s.body ?? "", "body", i, true);
        const prBase = s.base === undefined ? undefined : await branchName(repo, s.base, i);
        if (prBase === undefined && base === null)
          throw new Error(`step ${i + 1}: cannot tell the remote default branch; give open_pr a base`);
        steps.push(
          prBase === undefined ? { kind: "open_pr", title, body } : { kind: "open_pr", title, body, base: prBase },
        );
        break;
      }
      default:
        throw new Error(`step ${i + 1}: unknown step ${String(s.kind)}; use ${STEP_KINDS.join(", ")}`);
    }
  }
  return { steps, startBranch };
}

async function runOne(repo: Repo, s: GitStep, driver: GitDriver): Promise<StepResult> {
  const g = (args: string[], o: { slow?: boolean; env?: Record<string, string> } = {}) =>
    runGit(repo.top, args, { ...(o.slow ? { timeoutMs: SLOW_MS } : {}), ...(o.env ? { env: o.env } : {}) });
  switch (s.kind) {
    case "create_branch":
      await g(["switch", "-c", s.name, ...(s.from ? [s.from] : [])]);
      break;
    case "switch":
      await g(["switch", s.branch]);
      break;
    case "commit": {
      const tops = s.paths.map((p) => insideRoot(repo, p) as string);
      const who = await driver.author();
      const env = who
        ? {
            GIT_AUTHOR_NAME: who.name,
            GIT_AUTHOR_EMAIL: who.email,
            GIT_COMMITTER_NAME: who.name,
            GIT_COMMITTER_EMAIL: who.email,
          }
        : undefined;
      await g(["add", "-A", "--", ...tops]);
      // --only: changes staged earlier for other files stay out of this commit
      await g(["commit", "-q", "--only", "-m", s.message, "--", ...tops], { env });
      break;
    }
    case "push":
      await g(["push", "-u", "origin", `refs/heads/${s.branch}:refs/heads/${s.branch}`], {
        slow: true,
        env: await driver.remoteEnv(),
      });
      break;
    case "pull": {
      const now = await currentBranch(repo);
      if (now !== s.branch)
        throw new GitError(`pull ${s.branch} needs ${s.branch} checked out, but ${now ?? "no branch"} is`);
      await g(["pull", "--ff-only", "origin", `refs/heads/${s.branch}`], { slow: true, env: await driver.remoteEnv() });
      break;
    }
    case "open_pr": {
      const head = await currentBranch(repo);
      const base = s.base ?? (await defaultBranch(repo));
      if (!head || !base) throw new GitError("cannot tell the branch or the base branch for the PR");
      const pr = await driver.openPr(repo, { base, head, title: s.title, body: s.body });
      return { status: "done", url: pr.url, created: pr.created };
    }
  }
  return { status: "done" };
}

export async function runSteps(
  repo: Repo,
  steps: GitStep[],
  o: {
    driver: GitDriver;
    expectBranch: string | null;
    afterTreeChange: () => Promise<void>;
    onProgress?: (r: StepResult[]) => void;
  },
): Promise<StepResult[]> {
  const results: StepResult[] = steps.map(() => ({ status: "skipped" }));
  const now = await currentBranch(repo);
  if (now !== o.expectBranch) {
    const name = (b: string | null) => b ?? "no branch";
    results[0] = {
      status: "failed",
      message: `the checked-out branch changed from ${name(o.expectBranch)} to ${name(now)} since this was proposed; nothing was run`,
    };
    o.onProgress?.(results);
    return results;
  }
  for (const [i, s] of steps.entries()) {
    try {
      results[i] = await runOne(repo, s, o.driver);
    } catch (e) {
      results[i] = { status: "failed", message: e instanceof Error ? e.message : String(e) };
      o.onProgress?.(results);
      return results;
    }
    if (changesTree(s)) {
      try {
        await o.afterTreeChange();
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        results[i] = { status: "failed", message: `git succeeded but syncing the database failed: ${why}` };
        o.onProgress?.(results);
        return results;
      }
    }
    o.onProgress?.(results);
  }
  return results;
}
