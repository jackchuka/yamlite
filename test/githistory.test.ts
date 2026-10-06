import { renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import { beforeEach, expect, test } from "vitest";
import { type Extract, fileDiff, recordHistory } from "../src/githistory.ts";
import { markdownCodec } from "../src/source/markdown.ts";
import { PARSE_OPTIONS, yamlCodec } from "../src/source/yamldoc.ts";
import type { Rec } from "../src/types.ts";
import { commit, git, initRepo, useGitEnv } from "./gitrepo.ts";
import { tmpRoot, write } from "./helpers.ts";

beforeEach(useGitEnv);

const fromYaml: Extract = (c) => {
  const r = yamlCodec.read(c);
  return r.ok ? r.record : "unreadable";
};
const fromList =
  (key: string): Extract =>
  (c) => {
    const doc = parseDocument(c, PARSE_OPTIONS);
    if (doc.errors.length > 0 || (doc.contents !== null && !isSeq(doc.contents))) return "unreadable";
    for (const item of isSeq(doc.contents) ? doc.contents.items : []) {
      if (!isMap(item)) continue;
      const r = item.toJS(doc) as Rec;
      if (String(r.id) === key) return r;
    }
    return null;
  };

function repo(files: Record<string, string>): string {
  const root = tmpRoot();
  initRepo(root);
  for (const [p, c] of Object.entries(files)) write(join(root, p), c);
  return root;
}
const target = (root: string, rel: string, dir = "tasks") => ({ dir: join(root, dir), file: join(root, rel) });
const summary = (page: Awaited<ReturnType<typeof recordHistory>>) =>
  page.state === "ok"
    ? page.entries.map((e) => ({
        kind: e.kind,
        subject: e.subject,
        event: e.event,
        changes: e.changes.map((c) => c.path),
      }))
    : page.state;

test("commits that changed the record, newest first, with the record at each one", async () => {
  const root = repo({ "tasks/a.yaml": "title: A\ndone: false\n" });
  commit(root, "add a", "alice", "2026-10-01T00:00:00Z");
  write(join(root, "tasks/a.yaml"), "title: A\ndone: true\n");
  const second = commit(root, "finish a", "bob", "2026-10-02T00:00:00Z");
  const page = await recordHistory(target(root, "tasks/a.yaml"), fromYaml);
  expect(summary(page)).toEqual([
    { kind: "commit", subject: "finish a", event: undefined, changes: ["done"] },
    { kind: "commit", subject: "add a", event: "created", changes: ["title", "done"] },
  ]);
  if (page.state !== "ok") throw new Error(page.state);
  expect(page.entries[0]).toMatchObject({
    sha: second,
    head: true,
    author: "bob",
    date: "2026-10-02T00:00:00Z",
    path: join(root, "tasks/a.yaml"),
    record: { title: "A", done: true },
  });
  expect(page.entries[1]?.head).toBe(false);
  expect(page.next).toBeNull();
});

test("a comment-only change is left out", async () => {
  const root = repo({ "tasks/a.yaml": "title: A\n" });
  commit(root, "add a");
  write(join(root, "tasks/a.yaml"), "title: A # note\n");
  commit(root, "comment");
  expect(summary(await recordHistory(target(root, "tasks/a.yaml"), fromYaml))).toEqual([
    { kind: "commit", subject: "add a", event: "created", changes: ["title"] },
  ]);
});

test("a rename is followed and shown even without a value change", async () => {
  const root = repo({ "tasks/old.yaml": "title: A\n" });
  commit(root, "add");
  git(root, "mv", "tasks/old.yaml", "tasks/new.yaml");
  commit(root, "rename");
  const page = await recordHistory(target(root, "tasks/new.yaml"), fromYaml);
  expect(summary(page)).toEqual([
    { kind: "commit", subject: "rename", event: undefined, changes: [] },
    { kind: "commit", subject: "add", event: "created", changes: ["title"] },
  ]);
  if (page.state !== "ok") throw new Error(page.state);
  expect(page.entries[0]?.renamedFrom).toBe(join(root, "tasks/old.yaml"));
  expect(page.entries[1]?.path).toBe(join(root, "tasks/old.yaml"));
});

test("uncommitted changes come first, on the first page only", async () => {
  const root = repo({ "tasks/a.yaml": "title: A\n" });
  commit(root, "add");
  write(join(root, "tasks/a.yaml"), "title: B\n");
  const page = await recordHistory(target(root, "tasks/a.yaml"), fromYaml);
  expect(summary(page)).toEqual([
    { kind: "wip", subject: null, event: undefined, changes: ["title"] },
    { kind: "commit", subject: "add", event: "created", changes: ["title"] },
  ]);
  if (page.state !== "ok") throw new Error(page.state);
  expect(page.entries[0]).toMatchObject({ sha: null, record: { title: "B" } });
  expect(summary(await recordHistory(target(root, "tasks/a.yaml"), fromYaml, { cursor: "1" }))).toEqual([]);
});

test("a list file shows only the commits that changed that record", async () => {
  const root = repo({ "people.yaml": "- id: 1\n  name: Alice\n- id: 2\n  name: Bob\n" });
  commit(root, "add people");
  write(join(root, "people.yaml"), "- id: 1\n  name: Alice\n- id: 2\n  name: Robert\n");
  commit(root, "rename bob");
  write(join(root, "people.yaml"), "- id: 2\n  name: Robert\n");
  commit(root, "drop alice");
  const alice = await recordHistory({ dir: root, file: join(root, "people.yaml") }, fromList("1"));
  expect(summary(alice)).toEqual([
    { kind: "commit", subject: "drop alice", event: "deleted", changes: [] },
    { kind: "commit", subject: "add people", event: "created", changes: ["id", "name"] },
  ]);
  const bob = await recordHistory({ dir: root, file: join(root, "people.yaml") }, fromList("2"));
  expect(summary(bob)).toEqual([
    { kind: "commit", subject: "rename bob", event: undefined, changes: ["name"] },
    { kind: "commit", subject: "add people", event: "created", changes: ["id", "name"] },
  ]);
});

test("markdown: front matter and body", async () => {
  const codec = markdownCodec("body");
  const fromMd: Extract = (c) => {
    const r = codec.read(c);
    return r.ok ? r.record : "unreadable";
  };
  const root = repo({ "notes/a.md": "---\ntitle: A\n---\nhello\n" });
  commit(root, "add");
  write(join(root, "notes/a.md"), "---\ntitle: A\n---\nhello world\n");
  commit(root, "edit body");
  expect(summary(await recordHistory(target(root, "notes/a.md", "notes"), fromMd))).toEqual([
    { kind: "commit", subject: "edit body", event: undefined, changes: ["body"] },
    { kind: "commit", subject: "add", event: "created", changes: ["title", "body"] },
  ]);
});

test("a version that does not parse is shown as unreadable", async () => {
  const root = repo({ "tasks/a.yaml": "title: A\n" });
  commit(root, "add");
  write(join(root, "tasks/a.yaml"), "title: [\n");
  commit(root, "break");
  const page = await recordHistory(target(root, "tasks/a.yaml"), fromYaml);
  if (page.state !== "ok") throw new Error(page.state);
  expect(page.entries[0]).toMatchObject({ subject: "break", unreadable: true, record: null, changes: [] });
});

test("paging by commits scanned", async () => {
  const root = repo({ "tasks/a.yaml": "n: 0\n" });
  commit(root, "c0");
  for (let i = 1; i <= 4; i++) {
    write(join(root, "tasks/a.yaml"), `n: ${i}\n`);
    commit(root, `c${i}`);
  }
  const first = await recordHistory(target(root, "tasks/a.yaml"), fromYaml, { pageSize: 2 });
  if (first.state !== "ok") throw new Error(first.state);
  expect(first.entries.map((e) => e.subject)).toEqual(["c4", "c3"]);
  expect(first.next).toBe("2");
  const second = await recordHistory(target(root, "tasks/a.yaml"), fromYaml, { pageSize: 2, cursor: "2" });
  if (second.state !== "ok") throw new Error(second.state);
  expect(second.entries.map((e) => e.subject)).toEqual(["c2", "c1"]);
  const last = await recordHistory(target(root, "tasks/a.yaml"), fromYaml, { pageSize: 2, cursor: "4" });
  if (last.state !== "ok") throw new Error(last.state);
  expect(last.entries.map((e) => e.subject)).toEqual(["c0"]);
  expect(last.next).toBeNull();
});

test("paging is not thrown off by commits that do not touch the file", async () => {
  const root = repo({ "tasks/a.yaml": "n: 0\n", "other.txt": "0" });
  commit(root, "a0");
  for (let i = 1; i <= 3; i++) {
    write(join(root, "tasks/a.yaml"), `n: ${i}\n`);
    commit(root, `a${i}`);
    for (let j = 0; j < 3; j++) {
      write(join(root, "other.txt"), `${i}-${j}`);
      commit(root, `other ${i}-${j}`);
    }
  }
  const subjects: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await recordHistory(target(root, "tasks/a.yaml"), fromYaml, { pageSize: 2, cursor });
    if (page.state !== "ok") throw new Error(page.state);
    subjects.push(...page.entries.map((e) => e.subject ?? "wip"));
    cursor = page.next ?? undefined;
  } while (cursor !== undefined);
  expect(subjects).toEqual(["a3", "a2", "a1", "a0"]);
});

test("states: no repository, not committed yet, empty repository", async () => {
  const plain = tmpRoot();
  write(join(plain, "tasks/a.yaml"), "title: A\n");
  expect(await recordHistory(target(plain, "tasks/a.yaml"), fromYaml)).toEqual({ state: "nogit" });
  const fresh = repo({ "tasks/a.yaml": "title: A\n" });
  expect(await recordHistory(target(fresh, "tasks/a.yaml"), fromYaml)).toEqual({ state: "untracked" });
  write(join(fresh, "tasks/b.yaml"), "title: B\n");
  commit(fresh, "add");
  write(join(fresh, "tasks/c.yaml"), "title: C\n");
  expect(await recordHistory(target(fresh, "tasks/c.yaml"), fromYaml)).toEqual({ state: "untracked" });
});

test("a file name with glob characters matches only itself", async () => {
  const root = repo({ "tasks/[a].yaml": "title: X\n", "tasks/a.yaml": "title: Y\n" });
  commit(root, "add both");
  write(join(root, "tasks/a.yaml"), "title: Z\n");
  commit(root, "edit a only");
  expect(summary(await recordHistory(target(root, "tasks/[a].yaml"), fromYaml))).toEqual([
    { kind: "commit", subject: "add both", event: "created", changes: ["title"] },
  ]);
});

test("paths stay in the caller's namespace when the root is reached through a symlink", async () => {
  const real = repo({ "tasks/a.yaml": "title: A\n" });
  commit(real, "add");
  const link = join(tmpRoot(), "link");
  symlinkSync(real, link);
  const page = await recordHistory(target(link, "tasks/a.yaml"), fromYaml);
  if (page.state !== "ok") throw new Error(page.state);
  expect(page.entries[0]?.path).toBe(join(link, "tasks/a.yaml"));
});

test("fileDiff: a commit, the uncommitted change, and an unknown sha", async () => {
  const root = repo({ "tasks/a.yaml": "title: A\n" });
  const sha = commit(root, "add");
  write(join(root, "tasks/a.yaml"), "title: B\n");
  const t = target(root, "tasks/a.yaml");
  const shown = await fileDiff(t, sha);
  expect(shown.state === "ok" && shown.text).toContain("+title: A");
  const wip = await fileDiff(t, "wip");
  expect(wip.state === "ok" && wip.text).toContain("-title: A\n+title: B");
  expect(await fileDiff(t, "0".repeat(40))).toEqual({ state: "missing" });
});

test("fileDiff follows a rename", async () => {
  const root = repo({ "tasks/old.yaml": "title: A\n" });
  commit(root, "add");
  renameSync(join(root, "tasks/old.yaml"), join(root, "tasks/new.yaml"));
  const sha = commit(root, "rename");
  const res = await fileDiff(target(root, "tasks/new.yaml"), sha);
  expect(res.state === "ok" && res.text).toContain("rename from tasks/old.yaml");
});

test("a working file that is gone has no uncommitted entry", async () => {
  const root = repo({ "tasks/a.yaml": "title: A\n", "tasks/keep.yaml": "x: 1\n" });
  commit(root, "add");
  rmSync(join(root, "tasks/a.yaml"));
  expect(summary(await recordHistory(target(root, "tasks/a.yaml"), fromYaml))).toEqual([
    { kind: "commit", subject: "add", event: "created", changes: ["title"] },
  ]);
});
