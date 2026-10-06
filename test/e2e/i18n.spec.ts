import { rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { type Running, start, stop } from "./app.ts";

let app: Running | undefined;
test.afterEach(async () => {
  if (!app) return;
  const { child, root } = app;
  app = undefined;
  await stop(child);
  rmSync(root, { recursive: true, force: true });
});

test.describe("a Japanese browser", () => {
  test.use({ locale: "ja-JP" });

  test("opens the UI in Japanese", async ({ page }) => {
    app = await start({ "tasks/a.yaml": "title: one\n" }, (r) => (app = r));
    await page.goto(app.url);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.getByText(/を監視中/)).toBeVisible();
    await page.getByRole("row", { name: /one/ }).click();
    const drawer = page.getByRole("complementary", { name: "レコード" });
    await expect(drawer.getByRole("button", { name: /保存/ })).toBeVisible();
    await page.getByRole("link", { name: /SQL コンソール/ }).click();
    await expect(page.getByRole("button", { name: /実行/ })).toBeVisible();
  });
});

test("switching to Japanese from the status bar reloads in Japanese", async ({ page }) => {
  app = await start({ "tasks/a.yaml": "title: one\n" }, (r) => (app = r));
  await page.goto(app.url);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "日本語" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("combobox", { name: "言語" })).toBeVisible();
  await expect(page.getByText(/を監視中/)).toBeVisible();
});
