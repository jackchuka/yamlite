import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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

// a repo at root whose origin is a bare repository, with main pushed and origin/HEAD set.
// Most tests start from the same files, so the repositories built for a set of files are kept and copied: the commit's
// author and date are fixed, so a copy is the repository git would have built
export function withRemote(root: string): string {
  const bare = mkdtempSync(join(tmpdir(), "yamlite-remote-"));
  const key = filesKey(root);
  const built = key === null ? undefined : remotes.get(key);
  if (built) {
    cpSync(built.bare, bare, { recursive: true });
    cpSync(built.git, join(root, ".git"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), ".yamlite/\n");
    const config = join(root, ".git/config");
    writeFileSync(config, readFileSync(config, "utf8").replace(built.url, bare));
    // the index holds the other files' stat data, which plumbing such as diff-index takes for changes until refreshed
    git(root, "update-index", "-q", "--refresh");
    return bare;
  }
  git(bare, "init", "-q", "--bare", "-b", "main");
  initRepo(root);
  commit(root, "init");
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "-q", "-u", "origin", "main");
  git(root, "remote", "set-head", "origin", "main");
  // kept apart from the test's own, which goes on to commit and push
  if (key !== null) {
    const kept = mkdtempSync(join(tmpdir(), "yamlite-built-"));
    cpSync(bare, join(kept, "bare"), { recursive: true });
    cpSync(join(root, ".git"), join(kept, "git"), { recursive: true });
    remotes.set(key, { git: join(kept, "git"), bare: join(kept, "bare"), url: bare });
  }
  return bare;
}

const remotes = new Map<string, { git: string; bare: string; url: string }>();

// the files and folders under root, or null when it holds anything a copy might not reproduce
function filesKey(root: string): string | null {
  const parts: string[] = [];
  const walk = (dir: string): boolean => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      const rel = relative(root, path);
      if (rel === ".git" || rel === ".yamlite") return false;
      if (entry.isDirectory()) {
        parts.push(`d ${rel}`);
        if (!walk(path)) return false;
      } else if (entry.isFile() && (statSync(path).mode & 0o111) === 0) {
        parts.push(`f ${rel} ${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
      } else return false;
    }
    return true;
  };
  return walk(root) ? parts.join("\n") : null;
}
