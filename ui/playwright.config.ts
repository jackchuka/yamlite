import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../test/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 }, trace: "retain-on-failure" },
});
