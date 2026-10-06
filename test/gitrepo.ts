import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";

const ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "alice",
  GIT_AUTHOR_EMAIL: "alice@example.com",
  GIT_COMMITTER_NAME: "alice",
  GIT_COMMITTER_EMAIL: "alice@example.com",
};

// the code under test reads process.env, so the user's git config must not leak into it either
export function useGitEnv(): void {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: { ...process.env, ...ENV }, encoding: "utf8" });
}

export function initRepo(root: string): void {
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, ".gitignore"), ".yamlite/\n");
}

export function commit(root: string, message: string, author = "alice", date = "2026-10-01T00:00:00Z"): string {
  git(root, "add", "-A");
  execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: root,
    env: { ...process.env, ...ENV, GIT_AUTHOR_NAME: author, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  return git(root, "rev-parse", "HEAD").trim();
}
