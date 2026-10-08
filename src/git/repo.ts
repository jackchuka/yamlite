import { spawn } from "node:child_process";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { which } from "../agent/detect.ts";

export const FAST_MS = 10_000;
export const SLOW_MS = 60_000;
export const DIFF_LIMIT = 100_000;
export const LOG_LIMIT = 50;

export class GitError extends Error {}

export interface Repo {
  top: string;
  root: string;
  prefix: string;
}

export function runGit(
  cwd: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number; cmd?: string; env?: Record<string, string> } = {},
): Promise<string> {
  const cmd = opts.cmd ?? "git";
  return new Promise((done, fail) => {
    // a missing credential must fail the step, not wait on a prompt nobody sees; a driver cannot turn that off
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...opts.env, GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1", LC_ALL: "C" },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? FAST_MS);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.stdin.on("error", () => {});
    child.on("error", (e) => {
      clearTimeout(timer);
      fail(new GitError(`${cmd} could not run: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return done(Buffer.concat(out).toString());
      if (timedOut) return fail(new GitError(`${cmd} ${args[0]} timed out`));
      const first = Buffer.concat(err).toString().trim().split("\n")[0];
      fail(new GitError(first || `${cmd} ${args[0]} exited with ${code}`));
    });
    child.stdin.end(opts.input ?? "");
  });
}

export async function findRepo(root: string): Promise<Repo | null> {
  try {
    const [top = "", prefix = ""] = (await runGit(root, ["rev-parse", "--show-toplevel", "--show-prefix"])).split("\n");
    return { top, root: resolve(root), prefix };
  } catch {
    return null;
  }
}

const toRoot = (repo: Repo, topPath: string): string | null =>
  topPath.startsWith(repo.prefix) ? topPath.slice(repo.prefix.length) : null;

export async function currentBranch(repo: Repo): Promise<string | null> {
  try {
    return (await runGit(repo.top, ["symbolic-ref", "--short", "-q", "HEAD"])).trim() || null;
  } catch {
    return null;
  }
}

export async function defaultBranch(repo: Repo): Promise<string | null> {
  try {
    return (await runGit(repo.top, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]))
      .trim()
      .replace(/^origin\//, "");
  } catch {
    try {
      const out = await runGit(repo.top, ["ls-remote", "--symref", "origin", "HEAD"]);
      return /^ref: refs\/heads\/(\S+)\tHEAD/m.exec(out)?.[1] ?? null;
    } catch {
      return null;
    }
  }
}

export async function gitStatus(repo: Repo) {
  const out = await runGit(repo.top, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
  const entries = out.split("\0");
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const changes: Array<{ path: string; status: string }> = [];
  const add = (status: string, topPath: string) => {
    const path = toRoot(repo, topPath);
    if (path !== null) changes.push({ path, status });
  };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as string;
    if (e.startsWith("# branch.head ")) {
      const name = e.slice("# branch.head ".length);
      branch = name === "(detached)" ? null : name;
    } else if (e.startsWith("# branch.upstream ")) {
      upstream = e.slice("# branch.upstream ".length);
    } else if (e.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(e);
      ahead = Number(m?.[1] ?? 0);
      behind = Number(m?.[2] ?? 0);
    } else if (e.startsWith("? ")) {
      add("??", e.slice(2));
    } else if (e.startsWith("1 ")) {
      add(e.slice(2, 4).replaceAll(".", " "), e.split(" ").slice(8).join(" "));
    } else if (e.startsWith("2 ")) {
      // a rename carries its old path in the next entry
      add(e.slice(2, 4).replaceAll(".", " "), e.split(" ").slice(9).join(" "));
      i++;
    } else if (e.startsWith("u ")) {
      add(e.slice(2, 4).replaceAll(".", " "), e.split(" ").slice(10).join(" "));
    }
  }
  return { branch, upstream, ahead, behind, changes };
}

export async function gitDiff(repo: Repo, paths: string[] = []) {
  const scope = paths.map((p) => {
    const top = insideRoot(repo, p);
    if (top === null) throw new Error(`${p} must be inside the data folder`);
    return top;
  });
  if (scope.length === 0) scope.push(repo.prefix || ".");
  const out = await runGit(repo.top, ["diff", "--no-color", "--no-ext-diff", "HEAD", "--", ...scope]);
  const bytes = Buffer.from(out);
  if (bytes.length <= DIFF_LIMIT) return { diff: out, truncated: false };
  // cutting inside a multibyte char leaves a trailing U+FFFD
  return {
    diff: bytes
      .subarray(0, DIFF_LIMIT)
      .toString()
      .replace(/\uFFFD$/, ""),
    truncated: true,
  };
}

export async function gitLog(repo: Repo, limit = LOG_LIMIT) {
  const n = Math.min(Math.max(1, Math.floor(limit)), LOG_LIMIT);
  const out = await runGit(repo.top, ["log", `-n${n}`, "--format=%H%x1f%an%x1f%aI%x1f%s%x1e"]);
  return out
    .split("\x1e")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => {
      const [sha = "", author = "", date = "", subject = ""] = s.split("\x1f");
      return { sha, author, date, subject };
    });
}

export async function gitBranches(repo: Repo) {
  const local = (await runGit(repo.top, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]))
    .split("\n")
    .filter((s) => s !== "")
    .sort();
  return { current: await currentBranch(repo), local, defaultBranch: await defaultBranch(repo) };
}

export async function ghReady(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const gh = which("gh", env);
  if (!gh) return false;
  try {
    await runGit(process.cwd(), ["auth", "status"], { cmd: gh });
    return true;
  } catch {
    return false;
  }
}

// a data-root path → its path under the work tree top, or null when it leaves the data root
export function insideRoot(repo: Repo, path: string): string | null {
  const abs = resolve(repo.root, path);
  const rel = relative(repo.root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return repo.prefix + rel.split(sep).join(posix.sep);
}
