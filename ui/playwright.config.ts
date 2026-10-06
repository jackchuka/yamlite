import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../test/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      testIgnore: "**/mobile.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } },
    },
    { name: "mobile", testMatch: "**/mobile.spec.ts", use: { ...devices["iPhone 13"] } },
  ],
});
