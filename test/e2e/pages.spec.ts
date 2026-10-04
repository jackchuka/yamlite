import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { file, type Running, start, stop } from "./app.ts";

const KANBAN = readFileSync(resolve(import.meta.dirname, "../../examples/pages/kanban.html"), "utf8");

let app: Running | undefined;
test.afterEach(async () => {
  if (!app) return;
  const { child, root } = app;
  app = undefined;
  await stop(child);
  rmSync(root, { recursive: true, force: true });
});

const launch = (files: Record<string, string>) => start(files, (r) => (app = r));
const config = (page: string) => `tables: {}\npages:\n  board:\n    path: .pages/board.html\n    title: Board\n${page}`;

test("moving a card on the kanban page rewrites the record's file", async ({ page }) => {
  app = await launch({
    "yamlite.yaml": config("    access: { tasks: write }\n"),
    ".pages/board.html": KANBAN,
    "tasks/a.yaml": "# keep me\ntitle: Buy milk\nstatus: todo\n",
  });
  const running = app;
  await page.goto(running.url);
  await page.getByRole("link", { name: "Board" }).click();
  const frame = page.frameLocator('iframe[title="Board"]');
  await frame.getByText("Buy milk").dragTo(frame.locator('[data-status="done"]'));
  await expect.poll(() => file(running, "tasks/a.yaml")).toContain("status: done");
  expect(file(running, "tasks/a.yaml")).toContain("# keep me");
  await frame.getByText("Buy milk").click();
  await expect(page.getByRole("complementary", { name: "record" })).toBeVisible();
});

test("a page cannot read outside its access or reach the network", async ({ page }) => {
  app = await launch({
    "yamlite.yaml": config("    access: { tasks: read }\n    sql: true\n"),
    ".pages/board.html": `<pre id="out"></pre><script>
      const log = (s) => (document.getElementById("out").textContent += s + "\\n");
      yamlite.rows("secret").catch((e) => log("rows: " + e.status + " " + e.message));
      yamlite.sql("select * from secret").catch((e) => log("sql: " + e.status + " " + e.message));
      fetch("https://example.com/").then(() => log("fetch: ok"), () => log("fetch: blocked"));
    </script>`,
    "tasks/a.yaml": "title: A\n",
    "secret/s.yaml": "token: abc\n",
  });
  await page.goto(`${app.url}#/p/board`);
  const out = page.frameLocator('iframe[title="Board"]').locator("#out");
  await expect(out).toContainText("rows: 403 secret is not in this page's access");
  await expect(out).toContainText("sql: 403 secret is not in this page's access");
  await expect(out).toContainText("fetch: blocked");
  await expect(page.getByRole("alert")).toContainText("blocked: https://example.com");
});

test("saving the page's file reloads it", async ({ page }) => {
  app = await launch({ "yamlite.yaml": config(""), ".pages/board.html": "<p>first</p>" });
  await page.goto(`${app.url}#/p/board`);
  const frame = page.frameLocator('iframe[title="Board"]');
  await expect(frame.getByText("first")).toBeVisible();
  writeFileSync(join(app.root, ".pages/board.html"), "<p>second</p>");
  await expect(frame.getByText("second")).toBeVisible();
});

test("a page that navigates its frame away is cut off", async ({ page }) => {
  app = await launch({
    "yamlite.yaml": config(""),
    ".pages/board.html": `<button onclick="location.href='about:blank'">leave</button>`,
  });
  await page.goto(`${app.url}#/p/board`);
  await page.frameLocator('iframe[title="Board"]').getByRole("button", { name: "leave" }).click();
  await expect(page.getByRole("alert")).toContainText("別の URL に移動したため");
  await expect(page.locator('iframe[title="Board"]')).toHaveCount(0);
});
