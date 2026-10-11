import { rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { agentEnv, file, type Running, start, stop } from "./app.ts";

let app: Running | undefined;
test.afterEach(async () => {
  if (!app) return;
  const { child, root } = app;
  app = undefined;
  await stop(child);
  rmSync(root, { recursive: true, force: true });
});

test("ask, preview, apply", async ({ page }) => {
  app = await start(
    {
      "tasks/buy-milk.yaml": "# errand\ntitle: 牛乳を買う\ndone: false\n",
      "tasks/blog.yaml": "title: ブログ\ndone: false\n",
    },
    (r) => (app = r),
    undefined,
    await agentEnv([
      {
        tools: [
          {
            name: "propose_sql",
            args: { title: "牛乳を完了に", sql: "UPDATE tasks SET done = 1 WHERE id = 'buy-milk'" },
          },
        ],
      },
      { say: "1 件見つかりました。" },
    ]),
  );
  const running = app;
  await page.goto(running.url);
  await page.getByRole("link", { name: /tasks/ }).click();
  await page.getByRole("button", { name: "Ask AI" }).click();
  const panel = page.getByRole("complementary", { name: "Ask AI" });
  const input = panel.getByRole("textbox", { name: "Request to the AI" });
  await input.fill("牛乳を完了にして");
  await input.press("Enter");
  await expect(panel.getByText("1 件見つかりました。")).toBeVisible();
  const card = panel.getByRole("region", { name: "Proposal: 牛乳を完了に" });
  await expect(card).toBeVisible();
  await expect(page.locator('[data-key="buy-milk"][data-preview="update"]')).toBeVisible();
  expect(file(running, "tasks/buy-milk.yaml")).toContain("done: false");
  await card.getByRole("button", { name: "Apply 1 change" }).click();
  await expect(card.getByText("Applied")).toBeVisible();
  await expect.poll(() => file(running, "tasks/buy-milk.yaml")).toBe("# errand\ntitle: 牛乳を買う\ndone: true\n");
  await expect(page.locator('[data-key="buy-milk"][data-preview]')).toHaveCount(0);
});

test("no key: Ask AI opens the settings first", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: A\n" }, (r) => (app = r), undefined, {
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
  });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Ask AI" }).click();
  const panel = page.getByRole("complementary", { name: "Ask AI" });
  await expect(panel.getByRole("form", { name: "AI settings" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("a proposal card keeps its height and apply button in a long chat", async ({ page }) => {
  const lines = Array.from({ length: 30 }, (_, i) =>
    `${i + 1} 行目: タスクの一覧を確認しています。\n\n`.repeat(2),
  ).join("");
  app = await start(
    { "tasks/buy-milk.yaml": "title: 牛乳を買う\ndone: false\n" },
    (r) => (app = r),
    undefined,
    await agentEnv([
      {
        say: lines,
        tools: [
          {
            name: "propose_sql",
            args: { title: "牛乳を完了に", sql: "UPDATE tasks SET done = 1 WHERE id = 'buy-milk'" },
          },
        ],
      },
      { say: "" },
    ]),
  );
  await page.goto(app.url);
  await page.getByRole("link", { name: /tasks/ }).click();
  await page.getByRole("button", { name: "Ask AI" }).click();
  const panel = page.getByRole("complementary", { name: "Ask AI" });
  const input = panel.getByRole("textbox", { name: "Request to the AI" });
  await input.fill("完了にして");
  await input.press("Enter");
  const card = panel.getByRole("region", { name: "Proposal: 牛乳を完了に" });
  await expect(card).toBeAttached();
  const apply = card.getByRole("button", { name: "Apply 1 change" });
  await apply.scrollIntoViewIfNeeded();
  await expect(apply).toBeVisible();
  const box = await card.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(80);
  expect((await apply.boundingBox())?.height ?? 0).toBeGreaterThan(0);
});

test("a new conversation keeps the old one, which reopens from the Conversations menu", async ({ page }) => {
  app = await start(
    { "tasks/buy-milk.yaml": "title: 牛乳を買う\ndone: false\n" },
    (r) => (app = r),
    undefined,
    await agentEnv([{ say: "牛乳のタスクが 1 件あります。" }]),
  );
  await page.goto(app.url);
  await page.getByRole("button", { name: "Ask AI" }).click();
  const panel = page.getByRole("complementary", { name: "Ask AI" });
  const input = panel.getByRole("textbox", { name: "Request to the AI" });
  await input.fill("牛乳のタスクを探して");
  await input.press("Enter");
  await expect(panel.getByText("牛乳のタスクが 1 件あります。")).toBeVisible();
  await expect(panel.getByRole("status")).toHaveText("");
  await panel.getByRole("button", { name: "New conversation" }).click();
  await expect(panel.getByText("牛乳のタスクが 1 件あります。")).toHaveCount(0);
  await panel.getByRole("button", { name: "Conversations", exact: true }).click();
  await page.getByRole("menuitem", { name: /牛乳のタスクを探して/ }).click();
  await expect(panel.getByText("牛乳のタスクを探して")).toBeVisible();
  await expect(panel.getByText("牛乳のタスクが 1 件あります。")).toBeVisible();
});

test("Escape closes the Conversations menu first, then the panel", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: A\n" }, (r) => (app = r), undefined, await agentEnv([{ say: "ok" }]));
  await page.goto(app.url);
  await page.getByRole("button", { name: "Ask AI" }).click();
  const panel = page.getByRole("complementary", { name: "Ask AI" });
  await panel.getByRole("button", { name: "Conversations", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});
