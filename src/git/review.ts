import { type Repo, runGit, SLOW_MS } from "./repo.ts";
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

// the open PR of a branch, through gh; null without gh, without a PR, or when gh fails
export async function openPrUrl(repo: Repo, gh: string | null, branch: string): Promise<string | null> {
  if (!gh) return null;
  try {
    const out = await runGit(repo.top, ["pr", "view", branch, "--json", "url,state"], { cmd: gh, timeoutMs: SLOW_MS });
    const pr = JSON.parse(out) as { url?: unknown; state?: unknown };
    return pr.state === "OPEN" && typeof pr.url === "string" && pr.url.startsWith("https://") ? pr.url : null;
  } catch {
    return null;
  }
}
