import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { agentEnv, type Running, start, stop } from "./app.ts";

const SUMMARY = readFileSync(resolve(import.meta.dirname, "../../examples/pages/summary.html"), "utf8");

let app: Running | undefined;
test.afterEach(async () => {
  if (!app) return;
  const { child, root } = app;
  app = undefined;
  await stop(child);
  rmSync(root, { recursive: true, force: true });
});

const config = (extra: string) =>
  `tables: {}\npages:\n  notes:\n    path: .pages/notes.html\n    title: Notes\n    access: { tasks: read }\n${extra}`;
const tasks = { "tasks/a.yaml": "title: Buy milk\nstatus: todo\n" };
const frameOf = (page: import("@playwright/test").Page) => page.frameLocator('iframe[title="Notes"]');

test("the summary example streams the model's reply into the page", async ({ page }) => {
  app = await start(
    { ".pages/notes.html": SUMMARY, ...tasks },
    (r) => (app = r),
    config("    ai: true\n"),
    await agentEnv([{ say: "Milk is still to buy today, so remember it.", pace: 150 }]),
  );
  await page.goto(`${app.url}#/p/notes`);
  const frame = frameOf(page);
  await frame.getByRole("button", { name: "Summarize" }).click();
  const summary = frame.locator("#summary");
  await expect(summary).toContainText("Milk is");
  await expect(summary).not.toContainText("remember it.");
  await expect(summary).toHaveText("Milk is still to buy today, so remember it.");
});

test("generate returns the model's text", async ({ page }) => {
  app = await start(
    {
      ...tasks,
      ".pages/notes.html": `<pre id="out"></pre><script>
        yamlite.ai.generate({ prompt: "hi" }).then((r) => (out.textContent = "text: " + r.text));
      </script>`,
    },
    (r) => (app = r),
    config("    ai: true\n"),
    await agentEnv([{ say: "hello there" }]),
  );
  await page.goto(`${app.url}#/p/notes`);
  await expect(frameOf(page).locator("#out")).toHaveText("text: hello there");
});

test("a page without ai is refused with a YamliteError", async ({ page }) => {
  app = await start(
    {
      ...tasks,
      ".pages/notes.html": `<pre id="out"></pre><script>
        yamlite.ai.generate({ prompt: "hi" }).catch((e) => (out.textContent = (e instanceof yamlite.YamliteError) + " " + e.status));
      </script>`,
    },
    (r) => (app = r),
    config(""),
    await agentEnv([{ say: "unused" }]),
  );
  await page.goto(`${app.url}#/p/notes`);
  await expect(frameOf(page).locator("#out")).toHaveText("true 403");
});

test("with no host key the summary example hides its button", async ({ page }) => {
  app = await start({ ".pages/notes.html": SUMMARY, ...tasks }, (r) => (app = r), config("    ai: true\n"), {
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
  });
  await page.goto(`${app.url}#/p/notes`);
  const frame = frameOf(page);
  await expect(frame.getByRole("combobox", { name: "Record" })).toBeVisible();
  await expect(frame.getByRole("button", { name: "Summarize" })).toBeHidden();
});
