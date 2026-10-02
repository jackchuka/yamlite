import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [{ test: { name: "node", include: ["test/**/*.test.ts"] } }, "./ui/vite.config.ts"],
  },
});
