import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";

const bin = resolve(import.meta.dirname, "../../dist/cli.mjs");

interface Running {
  root: string;
  url: string;
  child: ChildProcess;
}

function put(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

async function stop(child: ChildProcess): Promise<void> {
  if (exited(child)) return;
  const done = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill("SIGINT");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await done;
  clearTimeout(timer);
}

async function start(files: Record<string, string>): Promise<Running> {
  const root = mkdtempSync(join(tmpdir(), "yamlite-e2e-"));
  put(join(root, "yamlite.yaml"), "tables: {}\n");
  for (const [path, content] of Object.entries(files)) put(join(root, path), content);
  const child = spawn(process.execPath, [bin, "serve", root, "--port", "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const running: Running = { root, url: "", child };
  app = running;
  running.url = await new Promise<string>((done, fail) => {
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error(`serve did not print its URL within 15s: ${out}`));
    }, 15_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
      const m = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/.exec(out);
      if (m?.[1]) {
        clearTimeout(timer);
        done(m[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`serve exited with ${code}: ${out}`));
    });
  });
  return running;
}

function sqlite(root: string, query: string): void {
  const db = new DatabaseSync(join(root, ".yamlite", "db.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(query);
  } finally {
    db.close();
  }
}

const file = (app: Running, path: string) => readFileSync(join(app.root, path), "utf8");

let app: Running | undefined;
test.afterEach(async () => {
  if (!app) return;
  const { child, root } = app;
  app = undefined;
  await stop(child);
  rmSync(root, { recursive: true, force: true });
});

test("an edit in the drawer reaches the file and keeps its comments", async ({ page }) => {
  app = await start({
    "tasks/buy-milk.yaml": "# errand\ntitle:\n  ja: 牛乳を買う\n  en: Buy milk\ndone: false\ntags: [errand, home]\n",
  });
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
  app = await start({ "tasks/a.yaml": "title: before\n" });
  await page.goto(app.url);
  await expect(page.getByRole("row", { name: /before/ })).toBeVisible();
  writeFileSync(join(app.root, "tasks/a.yaml"), "title: after\n");
  await expect(page.getByRole("row", { name: /after/ })).toBeVisible();
});

test("a conflict is announced and its losing side can be restored", async ({ page }) => {
  app = await start({ "tasks/fix-ci.yaml": "priority: 2\n" });
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
  app = await start({ "tasks/a.yaml": "title: A\n" });
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
  app = await start({
    "yamlite.yaml": "tables:\n  projects:\n    expand:\n      milestones:\n        expand:\n          tasks: {}\n",
    "projects/website.yaml":
      "title: Website\nmilestones:\n  - title: Design\n    tasks:\n      - title: Wireframes\n  - title: Launch\n",
  });
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
  app = await start({
    "yamlite.yaml": "tables:\n  tasks:\n    references:\n      assignee: people\n  people:\n    path: ./people.yaml\n",
    "people.yaml": "- id: ann\n",
    "tasks/a.yaml": "title: A\nassignee: ann\n",
    "tasks/b.yaml": "title: B\nassignee: zed\n",
  });
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
  app = await start({ "tasks/a.yaml": "title: A\n", "tasks/b.yaml": "title: B\n" });
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
  app = await start({ "tasks/a.yaml": "title: A\n" });
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
