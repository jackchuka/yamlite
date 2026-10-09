import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/core.ts",
    "src/cli.ts",
    "src/browser/aliases.ts",
    "src/browser/chokidar.ts",
    "src/browser/crypto.ts",
    "src/browser/fs.ts",
    "src/browser/expose.ts",
    "src/browser/globals.ts",
    "src/browser/os.ts",
    "src/browser/path.ts",
    "src/browser/sqlite.ts",
    "src/browser/unavailable.ts",
  ],
  format: "esm",
  dts: true,
  platform: "node",
  target: "node24",
  copy: ["src/guide.md"],
});
