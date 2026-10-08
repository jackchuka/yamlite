import { GitError, type Repo, runGit, SLOW_MS } from "./repo.ts";

const GITHUB = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const m = GITHUB.exec(url.trim());
  return m ? { owner: m[1] as string, repo: m[2] as string } : null;
}

// https://docs.github.com/en/pull-requests/reference/using-query-parameters-to-create-a-pull-request
export function compareUrl(
  r: { owner: string; repo: string },
  base: string,
  head: string,
  title: string,
  body: string,
): string {
  const e = encodeURIComponent;
  return `https://github.com/${r.owner}/${r.repo}/compare/${e(base)}...${e(head)}?quick_pull=1&title=${e(title)}&body=${e(body)}`;
}

export async function openPr(
  repo: Repo,
  o: { base: string; head: string; title: string; body: string; gh: string | null },
): Promise<{ url: string; created: boolean }> {
  if (o.gh) {
    const out = await runGit(
      repo.top,
      ["pr", "create", "--draft", "--base", o.base, "--head", o.head, "--title", o.title, "--body-file", "-"],
      { cmd: o.gh, input: o.body, timeoutMs: SLOW_MS },
    );
    const url = out.trim().split("\n").at(-1) ?? "";
    if (!url.startsWith("https://")) throw new GitError("gh did not print a pull request URL");
    return { url, created: true };
  }
  const remote = parseGithubRemote((await runGit(repo.top, ["remote", "get-url", "origin"])).trim());
  if (!remote) throw new GitError("origin is not a GitHub repository; push worked, open the pull request on your host");
  return { url: compareUrl(remote, o.base, o.head, o.title, o.body), created: false };
}
