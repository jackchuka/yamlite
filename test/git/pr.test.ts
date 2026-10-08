import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { compareUrl, openPr, parseGithubRemote } from "../../src/git/pr.ts";
import { findRepo } from "../../src/git/repo.ts";
import { git, useGitEnv, withRemote } from "../gitrepo.ts";
import { dataRoot, tmpRoot, write } from "../helpers.ts";

beforeEach(() => useGitEnv());

test.each([
  ["https://github.com/o/r.git", { owner: "o", repo: "r" }],
  ["https://github.com/o/r", { owner: "o", repo: "r" }],
  ["git@github.com:o/r.git", { owner: "o", repo: "r" }],
  ["ssh://git@github.com/o/r.git", { owner: "o", repo: "r" }],
  ["https://gitlab.com/o/r.git", null],
  ["/tmp/bare", null],
])("parseGithubRemote(%s)", (url, want) => {
  expect(parseGithubRemote(url)).toEqual(want);
});

test("compareUrl opens a quick pull with title and body encoded", () => {
  expect(compareUrl({ owner: "o", repo: "r" }, "main", "feat/x", "Add & fix", "line 1\nline 2")).toBe(
    "https://github.com/o/r/compare/main...feat%2Fx?quick_pull=1&title=Add%20%26%20fix&body=line%201%0Aline%202",
  );
});

test("openPr uses gh to create a draft and returns its URL", async () => {
  const root = dataRoot();
  withRemote(root);
  const log = join(tmpRoot(), "gh.log");
  const gh = join(tmpRoot(), "gh");
  write(gh, `#!/bin/sh\necho "$@" > ${log}\ncat >> ${log}\necho https://github.com/o/r/pull/7\n`);
  chmodSync(gh, 0o755);
  const out = await openPr((await findRepo(root))!, { base: "main", head: "x", title: "T", body: "B", gh });
  expect(out).toEqual({ url: "https://github.com/o/r/pull/7", created: true });
  expect(readFileSync(log, "utf8")).toBe("pr create --draft --base main --head x --title T --body-file -\nB");
});

test("without gh, openPr returns the compare link for a GitHub remote and fails for others", async () => {
  const root = dataRoot();
  withRemote(root);
  const repo = (await findRepo(root))!;
  await expect(openPr(repo, { base: "main", head: "x", title: "T", body: "", gh: null })).rejects.toThrow(/GitHub/);
  git(root, "remote", "set-url", "origin", "git@github.com:o/r.git");
  expect(await openPr(repo, { base: "main", head: "x", title: "T", body: "", gh: null })).toEqual({
    url: "https://github.com/o/r/compare/main...x?quick_pull=1&title=T&body=",
    created: false,
  });
});

test("openPr rejects gh output that is not an https URL", async () => {
  const root = dataRoot();
  withRemote(root);
  const gh = join(tmpRoot(), "gh");
  write(gh, "#!/bin/sh\ncat >/dev/null\necho 'javascript:alert(1)'\n");
  chmodSync(gh, 0o755);
  await expect(openPr((await findRepo(root))!, { base: "main", head: "x", title: "T", body: "B", gh })).rejects.toThrow(
    "gh did not print a pull request URL",
  );
});
