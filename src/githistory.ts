import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { canonical } from "./hash.ts";
import { own, type Rec } from "./types.ts";

export interface FieldChange {
  path: string;
  from: unknown;
  to: unknown;
}

const isMap = (v: unknown): v is Rec =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array);

const segment = (key: string): string => (/^[^.[\]"]+$/.test(key) ? key : `[${JSON.stringify(key)}]`);
const joinPath = (base: string, key: string): string => {
  const s = segment(key);
  return base === "" || s.startsWith("[") ? base + s : `${base}.${s}`;
};

// fields in the order of the newer version, then the removed ones
export function fieldChanges(before: Rec | null, after: Rec | null, base = ""): FieldChange[] {
  const a = before ?? {};
  const b = after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const out: FieldChange[] = [];
  for (const key of keys) {
    const from = own(a, key) ?? null;
    const to = own(b, key) ?? null;
    if (canonical(from) === canonical(to)) continue;
    const path = joinPath(base, key);
    if (isMap(from) && isMap(to)) out.push(...fieldChanges(from, to, path));
    else out.push({ path, from, to });
  }
  return out;
}

export type Extracted = Rec | null | "unreadable";
export type Extract = (content: string) => Extracted;

export interface HistoryTarget {
  // an existing folder that holds file; git runs from here to find the repository
  dir: string;
  file: string;
}

export interface HistoryEntry {
  kind: "wip" | "commit";
  sha: string | null;
  head: boolean;
  subject: string | null;
  author: string | null;
  date: string;
  path: string;
  renamedFrom?: string;
  event?: "created" | "deleted";
  unreadable?: boolean;
  changes: FieldChange[];
  record: Rec | null;
}

export type HistoryPage =
  | { state: "nogit" | "untracked" }
  | { state: "error"; message: string }
  | { state: "ok"; entries: HistoryEntry[]; next: string | null };

export type DiffResult =
  | { state: "nogit" | "untracked" | "missing" }
  | { state: "error"; message: string }
  | { state: "ok"; text: string };

export const PAGE_SIZE = 50;
const TIMEOUT_MS = 10_000;
const FORMAT = "%x1e%H%x1f%an%x1f%aI%x1f%s";
const OPTIONS = ["--literal-pathspecs", "-c", "log.showSignature=false", "-c", "color.ui=false"];

class GitMissing extends Error {}
class GitFailed extends Error {}

// reads only: no optional locks, so reading history never rewrites the index
function git(cwd: string, args: string[], input = ""): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...OPTIONS, ...args], {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.stdin.on("error", () => {});
    child.on("error", (e) => {
      clearTimeout(timer);
      reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new GitMissing("git is not installed") : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else if (timedOut) reject(new Error(`git ${args[0]} timed out`));
      else reject(new GitFailed(Buffer.concat(err).toString().trim() || `git ${args[0]} exited with ${code}`));
    });
    child.stdin.end(input);
  });
}

const succeeds = (p: Promise<unknown>): Promise<boolean> =>
  p.then(
    () => true,
    (e: unknown) => {
      if (e instanceof GitFailed) return false;
      throw e;
    },
  );

interface Repo {
  // the repository's top level, as git resolves it (symlinks followed)
  top: string;
  // the file relative to top
  path: string;
  // a path relative to top, mapped back into the caller's namespace
  abs: (repoPath: string) => string;
}

async function locate(t: HistoryTarget): Promise<Repo | null> {
  let out: string;
  try {
    out = (await git(t.dir, ["rev-parse", "--show-toplevel", "--show-prefix"])).toString();
  } catch (e) {
    if (e instanceof GitMissing || e instanceof GitFailed) return null;
    throw e;
  }
  const [top = "", prefix = ""] = out.split("\n");
  const path = prefix + relative(t.dir, t.file).split(sep).join("/");
  const abs = (p: string) => join(t.dir, posix.relative(`/${prefix}`, `/${p}`));
  return { top, path, abs };
}

async function head(top: string): Promise<string | null> {
  try {
    return (await git(top, ["rev-parse", "--verify", "-q", "HEAD"])).toString().trim();
  } catch (e) {
    if (e instanceof GitFailed) return null;
    throw e;
  }
}

interface LogCommit {
  sha: string;
  author: string;
  date: string;
  subject: string;
  status: string;
  path: string;
  from: string | null;
}

// `log --name-status -z`: "\x1e<fields>\0\n<status>\0<path>\0" per commit, two paths for a rename or copy
function parseLog(out: string): LogCommit[] {
  const commits: LogCommit[] = [];
  for (const chunk of out.split("\x1e")) {
    if (chunk === "") continue;
    const end = chunk.indexOf("\0");
    const [sha = "", author = "", date = "", subject = ""] = chunk.slice(0, end).split("\x1f");
    const files = chunk
      .slice(end + 1)
      .split("\0")
      .map((s) => s.replace(/^\n/, ""))
      .filter((s) => s !== "");
    const status = files[0];
    // a merge carries no file list
    if (status === undefined) continue;
    const moved = /^[RC]/.test(status);
    commits.push({
      sha,
      author,
      date,
      subject,
      status: status.slice(0, 1),
      path: (moved ? files[2] : files[1]) ?? "",
      from: moved ? (files[1] ?? null) : null,
    });
  }
  return commits;
}

async function log(top: string, path: string, extra: string[]): Promise<LogCommit[]> {
  const out = await git(top, ["log", "--follow", "--name-status", "-z", `--format=${FORMAT}`, ...extra, "--", path]);
  return parseLog(out.toString());
}

// one `cat-file --batch` for every "<rev>:<path>"; null for one that does not exist
async function readBlobs(top: string, specs: string[]): Promise<Array<string | null>> {
  if (specs.length === 0) return [];
  const out = await git(top, ["cat-file", "--batch"], specs.map((s) => `${s}\n`).join(""));
  const blobs: Array<string | null> = [];
  let i = 0;
  for (let n = 0; n < specs.length; n++) {
    const nl = out.indexOf(10, i);
    const header = out.subarray(i, nl).toString();
    i = nl + 1;
    if (header.endsWith(" missing") || header.endsWith(" ambiguous")) {
      blobs.push(null);
      continue;
    }
    const size = Number(header.slice(header.lastIndexOf(" ") + 1));
    blobs.push(out.subarray(i, i + size).toString("utf8"));
    i += size + 1;
  }
  return blobs;
}

const extractFrom = (extract: Extract, content: string | null): Extracted =>
  content === null ? null : extract(content);

type Described = Pick<HistoryEntry, "event" | "unreadable" | "changes" | "record">;

// what one version of a record changed against the previous one; null when neither has it
export function describeChange(before: Extracted, after: Extracted): Described | null {
  if (before === "unreadable" || after === "unreadable") {
    return { unreadable: true, changes: [], record: after === "unreadable" ? null : after };
  }
  if (before === null && after === null) return null;
  if (before === null) return { event: "created", changes: fieldChanges(null, after), record: after };
  if (after === null) return { event: "deleted", changes: [], record: null };
  return { changes: fieldChanges(before, after), record: after };
}

export const worthShowing = (d: Described): boolean =>
  d.changes.length > 0 || d.event !== undefined || d.unreadable === true;

async function working(repo: Repo, file: string, extract: Extract): Promise<HistoryEntry | null> {
  if (!existsSync(file)) return null;
  const content = readFileSync(file, "utf8");
  const [committed = null] = await readBlobs(repo.top, [`HEAD:${repo.path}`]);
  if (committed === content) return null;
  const d = describeChange(extractFrom(extract, committed), extract(content));
  if (!d || !worthShowing(d)) return null;
  return {
    kind: "wip",
    sha: null,
    head: false,
    subject: null,
    author: null,
    date: statSync(file).mtime.toISOString(),
    path: file,
    ...d,
  };
}

const failure = (e: unknown) => ({ state: "error" as const, message: e instanceof Error ? e.message : String(e) });

async function open(t: HistoryTarget): Promise<{ repo: Repo; head: string } | { state: "nogit" | "untracked" }> {
  if (!existsSync(t.dir)) throw new Error(`${t.dir} does not exist`);
  const repo = await locate(t);
  if (!repo) return { state: "nogit" };
  const sha = await head(repo.top);
  if (sha === null || !(await succeeds(git(repo.top, ["ls-files", "--error-unmatch", "--", repo.path])))) {
    return { state: "untracked" };
  }
  return { repo, head: sha };
}

export async function recordHistory(
  t: HistoryTarget,
  extract: Extract,
  opts: { cursor?: string; pageSize?: number } = {},
): Promise<HistoryPage> {
  try {
    const opened = await open(t);
    if ("state" in opened) return opened;
    const { repo } = opened;
    const skip = Number(opts.cursor ?? 0);
    const size = opts.pageSize ?? PAGE_SIZE;
    // with --follow, --skip also counts the commits that did not touch the file, so skip by slicing instead;
    // --max-count counts only the commits that are shown
    const found = await log(repo.top, repo.path, [`--max-count=${skip + size + 1}`]);
    const page = found.slice(skip, skip + size);
    const blobs = await readBlobs(
      repo.top,
      page.flatMap((c) => [`${c.sha}:${c.path}`, `${c.sha}^:${c.from ?? c.path}`]),
    );
    const entries: HistoryEntry[] = [];
    if (skip === 0) {
      const wip = await working(repo, t.file, extract);
      if (wip) entries.push(wip);
    }
    page.forEach((c, i) => {
      const after = c.status === "D" ? null : extractFrom(extract, blobs[2 * i] ?? null);
      const before = c.status === "A" ? null : extractFrom(extract, blobs[2 * i + 1] ?? null);
      const d = describeChange(before, after);
      if (!d || (!worthShowing(d) && c.from === null)) return;
      entries.push({
        kind: "commit",
        sha: c.sha,
        head: c.sha === opened.head,
        subject: c.subject,
        author: c.author,
        date: c.date,
        path: repo.abs(c.path),
        ...(c.from !== null ? { renamedFrom: repo.abs(c.from) } : {}),
        ...d,
      });
    });
    return { state: "ok", entries, next: found.length > skip + size ? String(skip + size) : null };
  } catch (e) {
    return failure(e);
  }
}

export async function fileDiff(t: HistoryTarget, rev: string): Promise<DiffResult> {
  try {
    const opened = await open(t);
    if ("state" in opened) return opened;
    const { repo } = opened;
    if (rev === "wip") {
      return { state: "ok", text: (await git(repo.top, ["diff", "--no-color", "HEAD", "--", repo.path])).toString() };
    }
    const c = (await log(repo.top, repo.path, [])).find((x) => x.sha === rev);
    if (!c) return { state: "missing" };
    const paths = c.from === null ? [c.path] : [c.from, c.path];
    const text = (await git(repo.top, ["show", "--no-color", "--format=", "-M", c.sha, "--", ...paths])).toString();
    return { state: "ok", text };
  } catch (e) {
    return failure(e);
  }
}
