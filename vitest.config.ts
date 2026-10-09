import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { browserAliases } from "./src/browser/aliases.ts";

// test modes for the browser build:
// - YAMLITE_SQLITE=wasm runs the node tests on sqlite-wasm instead of node:sqlite
// - YAMLITE_FS=mem on top of it puts node:fs in memory
// - YAMLITE_BROWSER=1 runs yamlite's core in a worker in Chromium and WebKit, with the database in OPFS
const wasm = process.env.YAMLITE_SQLITE === "wasm";
const mem = wasm && process.env.YAMLITE_FS === "mem";
const browser = process.env.YAMLITE_BROWSER === "1";
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const sqlite = { find: /^node:sqlite$/, replacement: here("./src/browser/sqlite.ts") };

const browserProject = {
  resolve: { alias: browserAliases() },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
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
                name: mem ? "wasm+memfs" : "wasm",
                include: ["test/**/*.test.ts"],
                exclude: ["test/browser/**"],
                setupFiles: ["test/wasm/setup.ts"],
                alias: [sqlite, ...(mem ? [{ find: /^node:fs$/, replacement: here("./test/wasm/memfs.ts") }] : [])],
              },
            },
          ]
        : [
            { test: { name: "node", include: ["test/**/*.test.ts"], exclude: ["test/wasm/**", "test/browser/**"] } },
            "./ui/vite.config.ts",
          ],
  },
});
