import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { agentEnv, file, type Running, sqlite, start, stop } from "./app.ts";

let app: Running | undefined;
test.afterEach(async () => {
  if (!app) return;
  const { child, root } = app;
  app = undefined;
  await stop(child);
  rmSync(root, { recursive: true, force: true });
});

const fitsWidth = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

test("the sidebar opens from the menu and closes after picking a table", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: A\n", "notes/n.yaml": "body: hi\n" }, (r) => (app = r));
  await page.goto(app.url);
  await expect(page.getByRole("row", { name: /hi/ })).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "sidebar" });
  await page.getByRole("button", { name: "menu" }).tap();
  await sidebar.getByRole("link", { name: /tasks/ }).tap();
  await expect(sidebar).toHaveCount(0);
  await expect(page.getByRole("row", { name: /A/ })).toBeVisible();
  // the table already open closes the sheet too
  await page.getByRole("button", { name: "menu" }).tap();
  await sidebar.getByRole("link", { name: /tasks/ }).tap();
  await expect(sidebar).toHaveCount(0);
});

test("the key column stays in view when the grid scrolls sideways", async ({ page }) => {
  app = await start(
    { "tasks/a.yaml": "title: A\nowner: ann\nstatus: open\nnote: long text here\nprio: 1\ndue: 2026-01-01\n" },
    (r) => (app = r),
  );
  await page.goto(app.url);
  const key = page.getByRole("gridcell", { name: "a", exact: true });
  await expect(key).toBeVisible();
  await page.getByRole("grid").evaluate((el) => (el.scrollLeft = 400));
  const box = await key.boundingBox();
  expect(box?.x).toBeLessThan(5);
});

test("a record is edited full screen, saved, and closed with the back button", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: before\n" }, (r) => (app = r));
  const running = app;
  await page.goto(running.url);
  await page.getByRole("row", { name: /before/ }).tap();
  const drawer = page.getByRole("complementary", { name: "record" });
  await expect(drawer).toBeVisible();
  expect((await drawer.boundingBox())?.width).toBe(page.viewportSize()?.width);
  const title = drawer.getByLabel("title", { exact: true });
  await title.tap();
  await expect(drawer.getByRole("button", { name: "Save" })).toBeInViewport();
  await title.fill("after");
  await drawer.getByRole("button", { name: "Save" }).tap();
  await expect.poll(() => file(running, "tasks/a.yaml")).toBe("title: after\n");
  await page.goBack();
  await expect(drawer).toHaveCount(0);
});

test("fields are at least 16px so iOS does not zoom in", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: A\nmeta: {x: 1}\n" }, (r) => (app = r));
  await page.goto(app.url);
  await page.getByRole("row", { name: /A/ }).tap();
  await expect(page.getByRole("complementary", { name: "record" }).getByLabel("title", { exact: true })).toBeVisible();
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll("input, textarea, select, .cm-editor")].map((el) =>
      Number.parseFloat(getComputedStyle(el).fontSize),
    ),
  );
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
});

test("no screen scrolls sideways", async ({ page }) => {
  app = await start(
    {
      "yamlite.yaml": `tables: {}\npages:\n  board:\n    path: .pages/board.html\n    title: ${"Quarterly planning board ".repeat(3)}\n`,
      ".pages/board.html": "<h1>Board</h1>",
      [`tasks/${"long-key-".repeat(12)}.yaml`]: "title: A\n",
    },
    (r) => (app = r),
  );
  for (const route of ["", "#/t/tasks", "#/sql", "#/sync", "#/erd", "#/p/board"]) {
    await page.goto(`${app.url}${route}`);
    await page.waitForLoadState("networkidle");
    await fitsWidth(page);
  }
  await page.goto(`${app.url}#/t/tasks`);
  await page.getByRole("row", { name: /long-key/ }).tap();
  await expect(page.getByRole("complementary", { name: "record" })).toBeVisible();
  await fitsWidth(page);
});

test("search opens from the top bar and navigates", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: A\n" }, (r) => (app = r));
  await page.goto(app.url);
  await page.getByRole("button", { name: "search" }).tap();
  await page.getByRole("option", { name: "SQL console" }).tap();
  await expect(page.locator(".cm-content").first()).toBeVisible();
});

test("the ERD opens a table from its title", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: A\n" }, (r) => (app = r));
  await page.goto(`${app.url}#/erd`);
  await page.locator(".react-flow__node").getByRole("link", { name: "tasks" }).tap();
  await expect(page.getByRole("row", { name: /A/ })).toBeVisible();
});

test("a conflict is restored with taps", async ({ page }) => {
  app = await start({ "tasks/fix-ci.yaml": "priority: 2\n" }, (r) => (app = r));
  const running = app;
  await page.goto(running.url);
  await expect(page.getByRole("row", { name: /fix-ci/ })).toBeVisible();
  sqlite(running.root, "UPDATE tasks SET priority = 3 WHERE id = 'fix-ci'");
  writeFileSync(join(running.root, "tasks/fix-ci.yaml"), "priority: 5\n");
  await expect(page.getByText("Conflict in tasks/fix-ci")).toBeVisible();
  const sides = ["priority: 3\n", "priority: 5\n"];
  await expect.poll(() => sides.includes(file(running, "tasks/fix-ci.yaml"))).toBe(true);
  const winner = file(running, "tasks/fix-ci.yaml");
  await page.goto(`${running.url}#/sync`);
  await page.getByRole("button", { name: /tasks \/ fix-ci/ }).tap();
  await page
    .getByRole("button", { name: /側に戻す/ })
    .first()
    .tap();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /側に戻す/ })
    .tap();
  await expect.poll(() => file(running, "tasks/fix-ci.yaml")).not.toBe(winner);
});

test("the AI panel opens full screen and applies a proposal", async ({ page }) => {
  app = await start(
    { "tasks/a.yaml": "title: A\ndone: false\n" },
    (r) => (app = r),
    undefined,
    agentEnv([
      [
        {
          mcp: "propose_changes",
          args: { title: "A を完了に", changes: [{ table: "tasks", key: "a", op: "update", values: { done: true } }] },
        },
      ],
    ]),
  );
  await page.goto(app.url);
  await page.getByRole("button", { name: "AI に依頼" }).tap();
  const panel = page.getByRole("complementary", { name: "AI に依頼" });
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())?.width).toBe(page.viewportSize()?.width);
  await panel.getByRole("textbox", { name: "AI への依頼" }).fill("A を完了に");
  await panel.getByRole("button", { name: "送信" }).tap();
  await panel.getByRole("button", { name: "1 件を適用" }).tap();
  await expect(panel.getByText("適用しました")).toBeVisible();
});
