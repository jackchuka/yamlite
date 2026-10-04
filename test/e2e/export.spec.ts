import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const bin = resolve(import.meta.dirname, "../../dist/cli.mjs");
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".sqlite": "application/octet-stream",
  ".woff2": "font/woff2",
};

let server: Server | undefined;
let work: string | undefined;
test.afterEach(async () => {
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  server = undefined;
  if (work) rmSync(work, { recursive: true, force: true });
});

// GitHub Pages serves a project site under /<repo>/
async function host(dir: string): Promise<string> {
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (!path.startsWith("/repo/")) return void res.writeHead(404).end();
    let file = join(dir, path.slice("/repo/".length));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  const listening = server;
  await new Promise<void>((done) => listening.listen(0, "127.0.0.1", () => done()));
  return `http://127.0.0.1:${(listening.address() as AddressInfo).port}/repo/`;
}

function exportFixture(): string {
  work = mkdtempSync(join(tmpdir(), "yamlite-export-e2e-"));
  const root = join(work, "data");
  const files: Record<string, string> = {
    "yamlite.yaml": "tables:\n  projects:\n    expand:\n      milestones: {}\n",
    "projects/website.yaml": "# the site\ntitle: Website\nmilestones:\n  - title: Design\n  - title: Launch\n",
    "projects/app.yaml": "title: App\n",
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  const out = join(work, "site");
  execFileSync(process.execPath, [bin, "export", root, "--out", out]);
  return out;
}

test("an export browses, queries and refuses writes from a subdirectory", async ({ page }) => {
  const url = await host(exportFixture());
  await page.goto(url);
  await expect(page.getByText(/Read-only snapshot/)).toBeVisible();
  await expect(page.getByRole("button", { name: /New record/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Sync/ })).toHaveCount(0);

  await page.getByRole("row", { name: /website/ }).click();
  const drawer = page.getByRole("complementary", { name: "record" });
  await expect(drawer.getByLabel("title", { exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: /Save/ })).toHaveCount(0);
  await drawer.getByRole("tab", { name: "YAML" }).click();
  await expect(drawer.getByText("# the site")).toBeVisible();
  await page.keyboard.press("Escape");

  const sidebar = page.getByRole("complementary", { name: "sidebar" });
  await sidebar.getByRole("link", { name: /projects__milestones/ }).click();
  await expect(page.getByRole("row", { name: /Launch/ })).toBeVisible();

  await sidebar.getByRole("link", { name: /SQL console/ }).click();
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("select title from projects order by title");
  await page.getByRole("button", { name: /Run/ }).click();
  await expect(page.getByRole("row", { name: /Website/ })).toBeVisible();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("update projects set title = 'x'");
  await page.getByRole("button", { name: /Run/ }).click();
  await expect(page.getByText(/read-only snapshot/)).toBeVisible();
});
