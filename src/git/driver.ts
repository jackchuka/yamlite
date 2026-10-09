import {
  type DiffResult,
  type Extract,
  fileDiff,
  type HistoryPage,
  type HistoryTarget,
  recordHistory,
} from "../githistory.ts";
import { findOpenPr } from "./pr.ts";
import { defaultBranch, findRepo, gitStatus, insideRoot, type Repo, runGit } from "./repo.ts";
import { localReview, type ReviewRequest } from "./review.ts";
import { type GitStep, type RunOptions, runSteps, type StepResult, validateSteps } from "./steps.ts";

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  changes: { path: string; status: "added" | "modified" | "deleted" }[]; // paths relative to the data root
}

// the git work the server needs: local serve uses the user's own git and gh, another host can supply its own
export interface GitDriver {
  // false: the UI shows no git footer
  hasRemote(): Promise<boolean>;
  status(): Promise<GitStatus>;
  defaultBranch(): Promise<string | null>;
  // the file at the base commit (HEAD locally); null when it has none
  baseContent(rootPath: string): Promise<string | null>;
  history(t: HistoryTarget, extract: Extract, o: { cursor?: string }): Promise<HistoryPage>;
  fileDiff(t: HistoryTarget, rev: string): Promise<DiffResult>;
  // runs inside the workspace's proposals.exclusive, after a sync; target null: a new PR
  review(
    req: ReviewRequest & { target: string | null },
    o: { afterTreeChange: () => Promise<void> },
  ): Promise<ReviewOutcome>;
  // present only where arbitrary git steps can run (a local checkout);
  // absent: no git tools for the agent, and applying a git proposal answers 404
  readonly steps?: StepRunner;
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
export async function localDriver(root: string, gh: () => Promise<string | null>): Promise<GitDriver> {
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
  await lookup();
  return {
    get steps() {
      return found?.steps;
    },
    async hasRemote() {
      const f = await lookup();
      if (!f) return false;
      try {
        await runGit(f.repo.top, ["remote", "get-url", "origin"]);
        return true;
      } catch {
        return false;
      }
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
    async defaultBranch() {
      const f = await lookup();
      if (!f) return null;
      base ??= await defaultBranch(f.repo);
      return base;
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
    history: (t, extract, o) => recordHistory(t, extract, o),
    fileDiff: (t, rev) => fileDiff(t, rev),
    async review(req, o) {
      if (req.target !== null) throw new ReviewRefused(400, "this server cannot add to an existing pull request");
      const { repo, steps } = await need();
      return localReview(steps, req, { ...o, findOpenPr: async (branch) => findOpenPr(repo, branch, await gh()) });
    },
  };
}
