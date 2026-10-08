import { fileURLToPath } from "node:url";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { paraglideOptions } from "./paraglide.config.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here("."),
  plugins: [paraglideVitePlugin(paraglideOptions), react(), tailwindcss()],
  resolve: { alias: { "@": here("./src") } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: here("../dist/ui-embed"),
    emptyOutDir: true,
    lib: { entry: here("./src/embed.tsx"), formats: ["es"], fileName: "embed", cssFileName: "style" },
  },
});
