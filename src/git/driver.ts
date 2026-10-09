import {
  type DiffResult,
  type Extract,
  fileDiff,
  type HistoryPage,
  type HistoryTarget,
  recordHistory,
} from "../githistory.ts";
import { findOpenPr } from "./pr.ts";
import { defaultBranch, gitStatus, insideRoot, type Repo, runGit } from "./repo.ts";
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

export function localDriver(repo: Repo, gh: () => Promise<string | null>): GitDriver {
  let base: string | null = null;
  const steps: StepRunner = {
    repo,
    validate: (raw) => validateSteps(repo, raw),
    run: (s, o) => runSteps(repo, s, { ...o, gh }),
  };
  return {
    steps,
    async hasRemote() {
      try {
        await runGit(repo.top, ["remote", "get-url", "origin"]);
        return true;
      } catch {
        return false;
      }
    },
    async status() {
      const s = await gitStatus(repo);
      const changes = s.changes
        .filter((c) => insideRoot(repo, c.path) !== null)
        .map((c) => ({ path: c.path, status: changeStatus(c.status) }));
      return { branch: s.branch, upstream: s.upstream, changes };
    },
    async defaultBranch() {
      base ??= await defaultBranch(repo);
      return base;
    },
    async baseContent(rootPath) {
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
      return localReview(steps, req, { ...o, findOpenPr: async (branch) => findOpenPr(repo, branch, await gh()) });
    },
  };
}
