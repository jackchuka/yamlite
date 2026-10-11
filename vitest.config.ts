import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { browserAliases } from "./src/browser/aliases.ts";

// test modes for the browser build:
// - YAMLITE_SQLITE=wasm runs the node tests on sqlite-wasm instead of node:sqlite
// - YAMLITE_FS=browser on top of it swaps in the browser build's node:fs and chokidar, for the tests of what that
//   build runs
// - YAMLITE_BROWSER=1 runs yamlite's core in a worker in Chromium and WebKit, with the database in OPFS
const wasm = process.env.YAMLITE_SQLITE === "wasm";
const browserFs = wasm && process.env.YAMLITE_FS === "browser";
// what the browser build does not have: git, agents, the CLI, the HTTP server and static export
const notInBrowser = [
  "test/agent/**",
  "test/git/**",
  "test/githistory.test.ts",
  "test/cli.test.ts",
  "test/export.test.ts",
  "test/guide.test.ts",
  "test/which.test.ts",
  "test/serve/agent.test.ts",
  "test/serve/git.test.ts",
  "test/serve/git-driver.test.ts",
  "test/serve/history.test.ts",
  "test/serve/http.test.ts",
  "test/serve/review.test.ts",
  "test/serve/revert.test.ts",
];
const browser = process.env.YAMLITE_BROWSER === "1";
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const sqlite = { find: /^node:sqlite$/, replacement: here("./src/browser/sqlite.ts") };

const browserProject = {
  resolve: { alias: browserAliases() },
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
    // found only while the tests run otherwise, and Vite reloads the page when it finds them
    include: ["ai", "@ai-sdk/anthropic", "@ai-sdk/openai"],
  },
  worker: { format: "es" as const },
  test: {
    name: "browser",
    include: ["test/browser/**/*.test.ts"],
    // two files at once share one origin's OPFS, and WebKit then fails getDirectory()
    fileParallelism: false,
    browser: {
      enabled: true,
      // a regular Playwright context is ephemeral, and WebKit refuses OPFS there as in private browsing
      provider: playwright({ persistentContext: true }),
      headless: true,
      instances: [{ browser: "chromium" as const }, { browser: "webkit" as const }],
    },
  },
};

export default defineConfig({
  test: {
    projects: browser
      ? [browserProject]
      : wasm
        ? [
            {
              test: {
                name: browserFs ? "wasm+browserfs" : "wasm",
                include: ["test/**/*.test.ts"],
                exclude: ["test/browser/**", ...(browserFs ? notInBrowser : [])],
                setupFiles: ["test/wasm/setup.ts"],
                alias: [
                  sqlite,
                  ...(browserFs
                    ? [
                        { find: /^node:fs$/, replacement: here("./test/wasm/browserfs.ts") },
                        { find: /^chokidar$/, replacement: here("./src/browser/chokidar.ts") },
                      ]
                    : []),
                ],
              },
            },
          ]
        : [
            { test: { name: "node", include: ["test/**/*.test.ts"], exclude: ["test/wasm/**", "test/browser/**"] } },
            "./ui/vite.config.ts",
          ],
  },
});
