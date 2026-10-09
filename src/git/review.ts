import { type ReviewOutcome, ReviewRefused, type StepRunner } from "./driver.ts";
import { defaultBranch, gitStatus } from "./repo.ts";
import type { GitStep } from "./steps.ts";

export interface ReviewRequest {
  title: string;
  body: string;
  paths: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");

// titles are often not ASCII, so the branch is named after the time instead
export function reviewBranch(now: Date): string {
  const d = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const t = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `yamlite/review-${d}-${t}`;
}

// on the default branch the changes move to a new branch; on any other branch they are added to it
export function reviewSteps(
  r: ReviewRequest,
  o: { branch: string; defaultBranch: string; now: Date; openPr: boolean },
): GitStep[] {
  const steps: GitStep[] = [];
  const branch = o.branch === o.defaultBranch ? reviewBranch(o.now) : o.branch;
  if (branch !== o.branch) steps.push({ kind: "create_branch", name: branch });
  steps.push({ kind: "commit", message: r.title, paths: r.paths }, { kind: "push", branch });
  if (o.openPr) steps.push({ kind: "open_pr", title: r.title, body: r.body });
  return steps;
}

// today's review: a new branch from the default branch, or more commits on the current one
export async function localReview(
  runner: StepRunner,
  req: ReviewRequest,
  o: { afterTreeChange: () => Promise<void>; findOpenPr: (branch: string) => Promise<string | null> },
): Promise<ReviewOutcome> {
  const { repo } = runner;
  const { branch } = await gitStatus(repo);
  if (branch === null) throw new ReviewRefused(409, "check out a branch first; HEAD is detached");
  const base = await defaultBranch(repo);
  if (base === null) throw new ReviewRefused(409, "cannot tell the remote default branch of origin");
  const existing = branch === base ? null : await o.findOpenPr(branch);
  const planned = reviewSteps(req, { branch, defaultBranch: base, now: new Date(), openPr: existing === null });
  let steps;
  try {
    ({ steps } = await runner.validate(planned));
  } catch (e) {
    throw new ReviewRefused(400, e instanceof Error ? e.message : String(e));
  }
  const results = await runner.run(steps, { expectBranch: branch, afterTreeChange: o.afterTreeChange });
  const failed = results.find((r) => r.status === "failed");
  const pr = results.find((r) => r.url);
  return {
    branch: steps[0]?.kind === "create_branch" ? steps[0].name : branch,
    steps: steps.map((s) => s.kind),
    results,
    url: pr?.url ?? existing,
    created: pr?.created ?? false,
    ...(failed ? { error: failed.message ?? "a git step failed" } : {}),
  };
}
