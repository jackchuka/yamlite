import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { file, type Running, sqlite, start, stop } from "./app.ts";

let app: Running | undefined;
test.afterEach(async () => {
  if (!app) return;
  const { child, root } = app;
  app = undefined;
  await stop(child);
  rmSync(root, { recursive: true, force: true });
});

test("an edit in the drawer reaches the file and keeps its comments", async ({ page }) => {
  app = await start(
    {
      "tasks/buy-milk.yaml": "# errand\ntitle:\n  ja: 牛乳を買う\n  en: Buy milk\ndone: false\ntags: [errand, home]\n",
    },
    (r) => (app = r),
  );
  await page.goto(app.url);
  await page.getByRole("row", { name: /buy-milk/ }).click();
  const drawer = page.getByRole("complementary", { name: "record" });
  await drawer.getByLabel("title.ja", { exact: true }).fill("牛乳を買った");
  await drawer.getByLabel("done", { exact: true }).click();
  await drawer.getByRole("button", { name: /Save/ }).click();
  await expect(drawer.getByRole("status")).toContainText("に反映済み");
  const text = file(app, "tasks/buy-milk.yaml");
  expect(text).toContain("# errand");
  expect(text).toContain("ja: 牛乳を買った");
  expect(text).toContain("done: true");
  expect(text).toContain("tags: [errand, home]");
});

test("an edit in the editor shows up in the grid", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: before\n" }, (r) => (app = r));
  await page.goto(app.url);
  await expect(page.getByRole("row", { name: /before/ })).toBeVisible();
  writeFileSync(join(app.root, "tasks/a.yaml"), "title: after\n");
  await expect(page.getByRole("row", { name: /after/ })).toBeVisible();
});

test("a conflict is announced and its losing side can be restored", async ({ page }) => {
  app = await start({ "tasks/fix-ci.yaml": "priority: 2\n" }, (r) => (app = r));
  const running = app;
  await page.goto(running.url);
  await expect(page.getByRole("row", { name: /fix-ci/ })).toBeVisible();
  // both sides change before the next sync runs
  sqlite(running.root, "UPDATE tasks SET priority = 3 WHERE id = 'fix-ci'");
  writeFileSync(join(running.root, "tasks/fix-ci.yaml"), "priority: 5\n");
  await expect(page.getByText("Conflict in tasks/fix-ci")).toBeVisible();
  const sides = ["priority: 3\n", "priority: 5\n"];
  await expect.poll(() => sides.includes(file(running, "tasks/fix-ci.yaml"))).toBe(true);
  const winner = file(running, "tasks/fix-ci.yaml");
  await expect.poll(() => file(running, "tasks/fix-ci.yaml"), { timeout: 2000 }).toBe(winner);
  const loser = sides.find((side) => side !== winner);
  await page.getByRole("link", { name: /^Sync/ }).click();
  const entry = page.getByRole("button", { name: /tasks \/ fix-ci/ });
  await expect(entry).toHaveCount(1);
  const original = (await entry.textContent())?.includes("db を採用") ? "db" : "file";
  await entry.click();
  await page.getByRole("button", { name: /側に戻す/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("現在の版は新しい退避として残る")).toBeVisible();
  await dialog.getByRole("button", { name: /側に戻す/ }).click();
  await expect.poll(() => file(running, "tasks/fix-ci.yaml")).toBe(loser);
  // the replaced winner is kept as a new backup: the original entry is gone, and the only one left
  // names the other side as the winner
  const swapped = original === "db" ? "file" : "db";
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(`${swapped} を採用`);
});

test("an UPDATE in the SQL console lists the files it changed", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: A\n" }, (r) => (app = r));
  const running = app;
  await page.goto(running.url);
  await page.getByRole("link", { name: /SQL console/ }).click();
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("update tasks set title = 'Z' where id = 'a'");
  await page.getByRole("button", { name: /Run/ }).click();
  await expect(page.getByText("1 row changed")).toBeVisible();
  await expect(page.getByText("tasks/a.yaml")).toBeVisible();
  await expect.poll(() => file(running, "tasks/a.yaml")).toBe("title: Z\n");
});

test("an expanded view is listed under its table and opens the record it comes from", async ({ page }) => {
  app = await start(
    {
      "yamlite.yaml": "tables:\n  projects:\n    expand:\n      milestones:\n        expand:\n          tasks: {}\n",
      "projects/website.yaml":
        "title: Website\nmilestones:\n  - title: Design\n    tasks:\n      - title: Wireframes\n  - title: Launch\n",
    },
    (r) => (app = r),
  );
  await page.goto(app.url);
  const sidebar = page.getByRole("complementary", { name: "sidebar" });
  await sidebar.getByRole("link", { name: /^projects__milestones(?!__)/ }).click();
  await expect(page.getByRole("heading", { name: "projects__milestones", exact: true })).toBeVisible();
  await expect(page.getByText("read-only view")).toBeVisible();
  await expect(page.getByRole("button", { name: /New record/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Launch/ })).toBeVisible();
  await page.getByRole("row", { name: /Design/ }).click();
  await expect(page.getByRole("complementary", { name: "record" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "projects", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "record" })).toHaveCount(0);
  await page.getByRole("button", { name: /Schema/ }).click();
  await page.getByRole("dialog").getByRole("link", { name: "projects__milestones__tasks" }).click();
  await expect(page.getByRole("heading", { name: "projects__milestones__tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Wireframes/ })).toBeVisible();
});

test("warnings sit next to the table's name and their messages open from the table", async ({ page }) => {
  app = await start(
    {
      "yamlite.yaml":
        "tables:\n  tasks:\n    references:\n      assignee: people\n  people:\n    path: ./people.yaml\n",
      "people.yaml": "- id: ann\n",
      "tasks/a.yaml": "title: A\nassignee: ann\n",
      "tasks/b.yaml": "title: B\nassignee: zed\n",
    },
    (r) => (app = r),
  );
  await page.goto(app.url);
  const sidebar = page.getByRole("complementary", { name: "sidebar" });
  const tasks = sidebar.getByRole("link", { name: /tasks/ });
  await expect(tasks.getByRole("img", { name: "1 warnings" })).toBeVisible();
  await expect(tasks).toContainText("2");
  await tasks.click();
  await page.getByRole("button", { name: /1 件の警告/ }).click();
  await expect(page.getByRole("list", { name: "warnings" })).toContainText('assignee "zed" not found in people.id (b)');
});

test("the record drawer closes on Escape and on a click outside it", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: A\n", "tasks/b.yaml": "title: B\n" }, (r) => (app = r));
  await page.goto(app.url);
  const drawer = page.getByRole("complementary", { name: "record" });
  await page.getByRole("row", { name: /\ba\b/ }).click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await page.getByRole("row", { name: /\ba\b/ }).click();
  await expect(drawer.getByText("tasks/a.yaml")).toBeVisible();
  await page.getByRole("row", { name: /\bb\b/ }).click();
  await expect(drawer.getByText("tasks/b.yaml")).toBeVisible();
  await page.getByRole("heading", { name: "tasks", exact: true }).click();
  await expect(drawer).toHaveCount(0);
});

test("dragging the drawer's edge resizes it, keeps it open and survives a reload", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: A\n" }, (r) => (app = r));
  await page.goto(app.url);
  const drawer = page.getByRole("complementary", { name: "record" });
  await page.getByRole("row", { name: /\ba\b/ }).click();
  await expect(drawer).toBeVisible();
  const edge = await page.getByRole("separator", { name: "Resize record panel" }).boundingBox();
  if (!edge) throw new Error("no resize handle");
  const x = edge.x + edge.width / 2;
  const y = edge.y + edge.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // released over the grid, outside the drawer
  await page.mouse.move(x - 200, y, { steps: 5 });
  await page.mouse.up();
  await expect(drawer).toBeVisible();
  expect(Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(560);
  await page.reload();
  await page.getByRole("row", { name: /\ba\b/ }).click();
  expect(Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(560);
});

test("the ERD draws tables and their references, and opens a table on double-click", async ({ page }) => {
  app = await start(
    {
      "yamlite.yaml":
        "tables:\n  tasks:\n    references:\n      assignee: people\n  people:\n    path: ./people.yaml\n",
      "people.yaml": "- id: ann\n",
      "tasks/a.yaml": "title: A\nassignee: ann\n",
      "tasks/b.yaml": "title: B\nassignee: zed\n",
    },
    (r) => (app = r),
  );
  await page.goto(app.url);
  await page.getByRole("complementary", { name: "sidebar" }).getByRole("link", { name: /^ERD/ }).click();
  const tasks = page.getByTestId("erd-node-tasks");
  await expect(tasks).toBeVisible();
  await expect(page.getByTestId("erd-node-people")).toBeVisible();
  await expect(page.getByTestId("rf__edge-ref:tasks.assignee")).toBeAttached();
  await expect(tasks.getByTitle('assignee "zed" not found in people.id (b)')).toBeVisible();
  // the column's own warning mark is what opens its problems, so it shows once
  await expect(tasks.getByRole("button", { name: "assignee problems" }).getByLabel("problem")).toBeVisible();
  await expect(tasks.getByLabel("problem", { exact: true })).toHaveCount(1);
  await page.getByTestId("rf__node-people").dblclick();
  await expect(page.getByRole("heading", { name: "people", exact: true })).toBeVisible();
});

test("editing a Markdown note's body in the drawer changes only the body in the file", async ({ page }) => {
  app = await start({
    "yamlite.yaml": 'tables:\n  notes:\n    files: "**/*.md"\n',
    "idea.md": "---\ntitle: Idea   # keep this comment\n---\n\nold body\n",
  });
  await page.goto(app.url);
  await page.getByRole("row", { name: /idea/ }).click();
  const drawer = page.getByRole("complementary", { name: "record" });
  await drawer.getByRole("tab", { name: "Edit" }).click();
  const editor = drawer.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("new body");
  await drawer.getByRole("button", { name: /Save/ }).click();
  await expect(drawer.getByRole("status")).toContainText("に反映済み");
  expect(file(app, "idea.md")).toBe("---\ntitle: Idea   # keep this comment\n---\nnew body");
  await drawer.getByRole("tab", { name: "File" }).click();
  await expect(drawer.getByText("# keep this comment")).toBeVisible();
});

test("a table's group is set in the header, written to yamlite.yaml and shown in the sidebar", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: A\n", "notes/a.yaml": "title: N\n" }, (r) => (app = r));
  const running = app;
  await page.goto(`${running.url}#/t/tasks`);
  await page.getByRole("button", { name: /^group:/ }).click();
  await page.getByRole("combobox", { name: "group name" }).fill("Work");
  await page.getByRole("button", { name: "保存" }).click();
  const sidebar = page.getByRole("complementary", { name: "sidebar" });
  const work = sidebar.getByRole("group", { name: "Work" });
  await expect(work.getByRole("link", { name: /tasks/ })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /notes/ })).toBeVisible();
  await expect(work.getByRole("link", { name: /notes/ })).toHaveCount(0);
  expect(file(running, "yamlite.yaml")).toMatch(/tasks:\n(?:\s{4}.*\n)*\s{4}group: Work\n/);
  await sidebar.getByRole("button", { name: "Work" }).click();
  await expect(work.getByRole("link", { name: /tasks/ })).toHaveCount(0);
});

test("a column with values is edited with a select and saved to the file", async ({ page }) => {
  app = await start(
    { "tasks/buy-milk.yaml": "# errand\nstatus: todo\n" },
    (r) => (app = r),
    "tables:\n  tasks:\n    columns: { status: TEXT }\n    values:\n      status: [todo, done]\n",
  );
  await page.goto(app.url);
  await page.getByRole("row", { name: /buy-milk/ }).click();
  const drawer = page.getByRole("complementary", { name: "record" });
  await drawer.getByLabel("status", { exact: true }).selectOption("done");
  await drawer.getByRole("button", { name: /Save/ }).click();
  await expect(drawer.getByRole("status")).toContainText("に反映済み");
  const text = file(app, "tasks/buy-milk.yaml");
  expect(text).toContain("# errand");
  expect(text).toContain("status: done");
});

test("dates are edited with pickers, keep their offset, and values out of bounds are marked", async ({ page }) => {
  app = await start(
    { "tasks/release.yaml": "# release\ndue: 2026-10-01\nat: 2026-10-06T09:00:00+09:00\npriority: 7\n" },
    (r) => (app = r),
    "tables:\n  tasks:\n    columns: { due: TEXT, at: TEXT, priority: INTEGER }\n    formats: { due: date, at: datetime }\n    max: { priority: 5 }\n",
  );
  await page.goto(app.url);
  await page.getByRole("row", { name: /release/ }).click();
  const drawer = page.getByRole("complementary", { name: "record" });
  await expect(drawer.getByText("above max 5")).toBeVisible();
  await drawer.getByLabel("due", { exact: true }).fill("2026-10-31");
  await drawer.getByLabel("at", { exact: true }).fill("2026-10-06T12:30");
  await drawer.getByRole("button", { name: /Save/ }).click();
  await expect(drawer.getByRole("status")).toContainText("に反映済み");
  const text = file(app, "tasks/release.yaml");
  expect(text).toContain("# release");
  expect(text).toMatch(/due: "?2026-10-31"?\n/);
  expect(text).toMatch(/at: "?2026-10-06T12:30:00\+09:00"?\n/);
});

test("an edit from the form shows up in History as an uncommitted change", async ({ page }) => {
  app = await start({ "tasks/fix-ci.yaml": "title: Fix CI\n" }, (r) => (app = r));
  const running = app;
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "alice",
    GIT_AUTHOR_EMAIL: "alice@example.com",
    GIT_COMMITTER_NAME: "alice",
    GIT_COMMITTER_EMAIL: "alice@example.com",
  };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: running.root, env });
  git("init", "-q", "-b", "main");
  writeFileSync(join(running.root, ".gitignore"), ".yamlite/\n");
  git("add", "-A");
  git("commit", "-q", "-m", "add fix-ci");
  await page.goto(running.url);
  await page.getByRole("row", { name: /fix-ci/ }).click();
  const drawer = page.getByRole("complementary", { name: "record" });
  await drawer.getByLabel("title", { exact: true }).fill("Fix flaky CI");
  await drawer.getByRole("button", { name: /Save/ }).click();
  await expect.poll(() => file(running, "tasks/fix-ci.yaml")).toBe("title: Fix flaky CI\n");
  await drawer.getByRole("tab", { name: /History/ }).click();
  await expect(drawer.getByText("未コミットの変更")).toBeVisible();
  await expect(drawer.getByText("add fix-ci")).toBeVisible();
});
