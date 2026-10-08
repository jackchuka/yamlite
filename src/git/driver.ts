import {
  type DiffResult,
  type Extract,
  fileDiff,
  type HistoryPage,
  type HistoryTarget,
  recordHistory,
} from "../githistory.ts";
import { openPr as ghOrCompare } from "./pr.ts";
import { defaultBranch, gitStatus, insideRoot, type Repo, runGit, SLOW_MS } from "./repo.ts";
import { localReview, type ReviewRequest } from "./review.ts";
import type { StepResult } from "./steps.ts";

export interface PrRequest {
  base: string;
  head: string;
  title: string;
  body: string;
}

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  changes: { path: string; status: "added" | "modified" | "deleted" }[]; // paths relative to the data root
}

// the git work the server needs: local serve uses the user's own git and gh, another host can supply its own
export interface GitDriver {
  // null when there is no repository on disk (a browser); steps must then be false
  readonly repo: Repo | null;
  // false: no propose_git for the agent, and applying a git proposal answers 404
  readonly steps: boolean;
  // false: the UI shows no git footer
  hasRemote(): Promise<boolean>;
  status(): Promise<GitStatus>;
  defaultBranch(): Promise<string | null>;
  // the file at the base commit (HEAD locally); null when it has none
  baseContent(rootPath: string): Promise<string | null>;
  history(t: HistoryTarget, extract: Extract, o: { cursor?: string }): Promise<HistoryPage>;
  fileDiff(t: HistoryTarget, rev: string): Promise<DiffResult>;
  // added to the env of git commands that reach the remote (push, pull, fetch)
  remoteEnv(): Promise<Record<string, string>>;
  // the commit author; null keeps git's own configuration
  author(): Promise<{ name: string; email: string } | null>;
  findOpenPr(branch: string): Promise<string | null>;
  openPr(o: PrRequest): Promise<{ url: string; created: boolean }>;
  // runs inside the workspace's proposals.exclusive, after a sync; target null: a new PR
  review(
    req: ReviewRequest & { target: string | null },
    o: { afterTreeChange: () => Promise<void> },
  ): Promise<ReviewOutcome>;
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

export function localDriver(repo: Repo, _root: string, gh: () => Promise<string | null>): GitDriver {
  let base: string | null = null;
  const d: GitDriver = {
    repo,
    steps: true,
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
    remoteEnv: async () => ({}),
    author: async () => null,
    async findOpenPr(branch) {
      const bin = await gh();
      if (!bin) return null;
      try {
        const out = await runGit(repo.top, ["pr", "view", branch, "--json", "url,state"], {
          cmd: bin,
          timeoutMs: SLOW_MS,
        });
        const pr = JSON.parse(out) as { url?: unknown; state?: unknown };
        return pr.state === "OPEN" && typeof pr.url === "string" && pr.url.startsWith("https://") ? pr.url : null;
      } catch {
        return null;
      }
    },
    async openPr(o) {
      return ghOrCompare(repo, { ...o, gh: await gh() });
    },
    async review(req, o) {
      if (req.target !== null) throw new ReviewRefused(400, "this server cannot add to an existing pull request");
      return localReview(repo, d, req, o);
    },
  };
  return d;
}
