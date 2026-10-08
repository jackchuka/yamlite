import { openPr as ghOrCompare } from "./pr.ts";
import { type Repo, runGit, SLOW_MS } from "./repo.ts";
import { localReview, type ReviewRequest } from "./review.ts";
import type { StepResult } from "./steps.ts";

export interface PrRequest {
  base: string;
  head: string;
  title: string;
  body: string;
}

// the git work that reaches the hosting service: local serve uses the user's own git and gh, team mode a user token
export interface GitDriver {
  // added to the env of git commands that reach the remote (push, pull, fetch)
  remoteEnv(): Promise<Record<string, string>>;
  // the commit author; null keeps git's own configuration
  author(): Promise<{ name: string; email: string } | null>;
  findOpenPr(repo: Repo, branch: string): Promise<string | null>;
  openPr(repo: Repo, o: PrRequest): Promise<{ url: string; created: boolean }>;
  // false: no propose_git for the agent, and applying a git proposal answers 404
  readonly steps: boolean;
  // runs inside the workspace's proposals.exclusive, after a sync; target null: a new PR
  review(
    repo: Repo,
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

export function localDriver(gh: () => Promise<string | null>): GitDriver {
  const d: GitDriver = {
    steps: true,
    remoteEnv: async () => ({}),
    author: async () => null,
    async findOpenPr(repo, branch) {
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
    async openPr(repo, o) {
      return ghOrCompare(repo, { ...o, gh: await gh() });
    },
    async review(repo, req, o) {
      if (req.target !== null) throw new ReviewRefused(400, "adding to an existing PR is a team mode feature");
      return localReview(repo, d, req, o);
    },
  };
  return d;
}
