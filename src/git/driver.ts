import { type DiffResult, type Extract, fileDiff, type HistoryTarget, recordHistory } from "../githistory.ts";
import { findOpenPr, templatePath } from "./pr.ts";
import {
  currentBranch,
  defaultBranch,
  findRepo,
  GitError,
  gitStatus,
  insideRoot,
  type Repo,
  runGit,
  runGitBytes,
  SLOW_MS,
  toRoot,
} from "./repo.ts";
import { localReview, type ReviewRequest } from "./review.ts";
import { type RunOptions, runSteps, validateSteps } from "./steps.ts";
import type { GitStep, StepResult } from "./types.ts";
import type { HistoryPage } from "../types.ts";

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  changes: { path: string; status: "added" | "modified" | "deleted" }[]; // paths relative to the data root
}

// what the server needs from where the data folder comes from: local serve uses the user's own git and gh, another
// host supplies its own. Each optional part is a capability the UI shows only when it is there
export interface WorkspaceDriver {
  status(): Promise<GitStatus>;
  // the file at the base commit (HEAD locally); null when it has none
  baseContent(rootPath: string): Promise<string | null>;
  // the file's bytes at the base commit, as a checkout writes them; null only when the commit has no file there,
  // and a throw when that cannot be told, since a caller may remove a file it gets null for
  baseFile(rootPath: string): Promise<Uint8Array | null>;
  // absent: the history panel answers nogit
  history?(t: HistoryTarget, extract: Extract, o: { cursor?: string }): Promise<HistoryPage>;
  fileDiff?(t: HistoryTarget, rev: string): Promise<DiffResult>;
  // absent: no git footer
  review?: ReviewCapability;
  // present only where arbitrary git steps can run (a local checkout);
  // absent: no git tools for the agent, and applying a git proposal answers 404
  readonly steps?: StepRunner;
}

// sending edits for review on a branch, as a pull request
export interface ReviewCapability {
  // false: the UI shows no git footer. Asked each time, as a local repository can get its origin after start
  available(): Promise<boolean>;
  defaultBranch(): Promise<string | null>;
  // runs inside the workspace's proposals.exclusive, after a sync; target null: a new PR
  review(
    req: ReviewRequest & { target: string | null },
    o: { afterTreeChange: () => Promise<void> },
  ): Promise<ReviewOutcome>;
  // the open PR a review from the current branch is added to; null when there is none or it cannot be told
  openPr?(): Promise<string | null>;
  // the repository's pull request template (see templatePath), which drafted descriptions follow; null when none
  pullRequestTemplate?(): Promise<string | null>;
  // true: a review from the default branch goes to the branch name the user gives; otherwise the host names it
  readonly namesBranch?: boolean;
  // present where the host can read the default branch; absent: the UI offers no way to put files back as it has them
  readonly defaultBranchFiles?: DefaultBranchFiles;
}

// the default branch, for putting part of a review back the way the default branch has it
export interface DefaultBranchFiles {
  // the files the current branch's commits change since it left the default branch, as the review shows them;
  // unsent edits are not included. Empty on the default branch and with no branch checked out
  changes(): Promise<GitStatus["changes"]>;
  // as baseFile, at the default branch's tip: null only when the default branch has no file there
  file(rootPath: string): Promise<Uint8Array | null>;
}

// git steps on a repository on disk: what the agent's git tools and proposals run on
export interface StepRunner {
  readonly repo: Repo;
  validate(raw: unknown): Promise<{ steps: GitStep[]; startBranch: string | null }>;
  run(steps: GitStep[], o: RunOptions): Promise<StepResult[]>;
}

export interface ReviewOutcome {
  branch: string;
  steps: string[];
  results: StepResult[];
  url: string | null;
  created: boolean;
  error?: string;
}

// a review the driver will not start; status is the HTTP status the route answers with
export class ReviewRefused extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

// porcelain v2 XY codes, staged or not
function changeStatus(xy: string): GitStatus["changes"][number]["status"] {
  if (xy === "??" || xy.includes("A")) return "added";
  if (xy.includes("D")) return "deleted";
  return "modified";
}

// a local driver's answer when the data folder is not (yet) in a git repository
export class NoRepository extends Error {
  constructor() {
    super("the data folder is not in a git repository");
  }
}

// the user's own git and gh; the repository is looked up on each use until one exists, so `git init` after start works
export async function localDriver(root: string, gh: () => Promise<string | null>): Promise<WorkspaceDriver> {
  let found: { repo: Repo; steps: StepRunner } | null = null;
  let base: string | null = null;
  const lookup = async () => {
    if (found) return found;
    const repo = await findRepo(root);
    if (!repo) return null;
    found ??= {
      repo,
      steps: {
        repo,
        validate: (raw) => validateSteps(repo, raw),
        run: (s, o) => runSteps(repo, s, { ...o, gh }),
      },
    };
    return found;
  };
  const need = async () => {
    const f = await lookup();
    if (!f) throw new NoRepository();
    return f;
  };
  const defaultName = async () => {
    const f = await lookup();
    if (!f) return null;
    base ??= await defaultBranch(f.repo);
    return base;
  };
  await lookup();
  return {
    get steps() {
      return found?.steps;
    },
    async status() {
      const f = await lookup();
      if (!f) return { branch: null, upstream: null, changes: [] };
      const s = await gitStatus(f.repo);
      const changes = s.changes
        .filter((c) => insideRoot(f.repo, c.path) !== null)
        .map((c) => ({ path: c.path, status: changeStatus(c.status) }));
      return { branch: s.branch, upstream: s.upstream, changes };
    },
    async baseContent(rootPath) {
      const { repo } = await need();
      const top = insideRoot(repo, rootPath);
      if (top === null) return null;
      try {
        return await runGit(repo.top, ["show", `HEAD:${top}`]);
      } catch {
        return null;
      }
    },
    async baseFile(rootPath) {
      return blobAt((await need()).repo, "HEAD", rootPath);
    },
    history: (t, extract, o) => recordHistory(t, extract, o),
    fileDiff: (t, rev) => fileDiff(t, rev),
    review: {
      namesBranch: true,
      async available() {
        const f = await lookup();
        if (!f) return false;
        try {
          await runGit(f.repo.top, ["remote", "get-url", "origin"]);
          return true;
        } catch {
          return false;
        }
      },
      defaultBranch: defaultName,
      defaultBranchFiles: {
        async changes() {
          const f = await lookup();
          if (!f) return [];
          const [branch, name] = [await currentBranch(f.repo), await defaultName()];
          if (branch === null || name === null || branch === name) return [];
          // three dots: what the branch changes since it left the default branch, as the pull request shows it
          const out = await runGit(f.repo.top, [
            "diff",
            "--name-status",
            "--no-renames",
            "-z",
            `${await defaultRef(f.repo, name)}...HEAD`,
            "--",
            f.repo.prefix || ".",
          ]);
          const parts = out.split("\0");
          const changes: GitStatus["changes"] = [];
          for (let i = 0; i + 1 < parts.length; i += 2) {
            const path = toRoot(f.repo, parts[i + 1] as string);
            if (path === null) continue;
            const code = parts[i] as string;
            changes.push({ path, status: code === "A" ? "added" : code === "D" ? "deleted" : "modified" });
          }
          return changes;
        },
        async file(rootPath) {
          const { repo } = await need();
          const name = await defaultName();
          if (name === null) throw new GitError("the default branch is not known");
          return blobAt(repo, await defaultRef(repo, name), rootPath);
        },
      },
      async openPr() {
        const f = await lookup();
        if (!f) return null;
        const branch = await currentBranch(f.repo);
        if (branch === null || branch === (await defaultName())) return null;
        return findOpenPr(f.repo, branch, await gh());
      },
      async pullRequestTemplate() {
        const f = await lookup();
        if (!f) return null;
        const listed = await runGit(f.repo.top, [
          "ls-tree",
          "--name-only",
          "HEAD",
          "--",
          ".",
          ".github/",
          "docs/",
        ]).catch(() => "");
        const path = templatePath(listed.split("\n"));
        return path === null ? null : runGit(f.repo.top, ["show", `HEAD:${path}`]).catch(() => null);
      },
      async review(req, o) {
        if (req.target !== null) throw new ReviewRefused(400, "this server cannot add to an existing pull request");
        const { repo, steps } = await need();
        return localReview(steps, req, { ...o, findOpenPr: async (branch) => findOpenPr(repo, branch, await gh()) });
      },
    },
  };
}

// the default branch as the remote has it, which is what a review is compared with; a local one when never fetched
async function defaultRef(repo: Repo, name: string): Promise<string> {
  for (const ref of [`refs/remotes/origin/${name}`, `refs/heads/${name}`]) {
    const found = await runGit(repo.top, ["rev-parse", "-q", "--verify", `${ref}^{commit}`]).then(
      () => true,
      () => false,
    );
    if (found) return ref;
  }
  throw new GitError(`the default branch ${name} is not in this clone`);
}

// the file's bytes at rev, as a checkout writes them; null when rev has no file there or does not exist yet
async function blobAt(repo: Repo, rev: string, rootPath: string): Promise<Uint8Array | null> {
  const top = insideRoot(repo, rootPath);
  if (top === null) throw new GitError(`${rootPath} is outside the repository`);
  let entry: string;
  try {
    entry = await runGit(repo.top, ["ls-tree", "-z", rev, "--", top]);
  } catch (e) {
    const born = await runGit(repo.top, ["rev-parse", "-q", "--verify", rev]).then(
      () => true,
      () => false,
    );
    if (!born) return null;
    throw e;
  }
  if (entry === "") return null;
  const type = entry.split(" ")[1];
  if (type !== "blob") throw new GitError(`${rootPath} is a ${type === "commit" ? "submodule" : "folder"}`);
  // through the repository's filters, so a Git LFS file comes back as its content, not its pointer
  return runGitBytes(repo.top, ["cat-file", "--filters", `${rev}:${top}`], { timeoutMs: SLOW_MS });
}
