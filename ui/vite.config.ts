import { fileURLToPath } from "node:url";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";
import { paraglideOptions } from "./paraglide.config.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
// pnpm dev:ui proxies the API of a running `yamlite serve`; pass its token in YAMLITE_TOKEN
const token = process.env.YAMLITE_TOKEN;
const target = process.env.YAMLITE_URL ?? "http://127.0.0.1:4610";

// the proxy adds the token, so a page on another origin must not be able to use it
const sameOriginOnly: Plugin = {
  name: "yamlite-same-origin-api",
  configureServer(server) {
    server.middlewares.use("/api", (req, res, next) => {
      const origin = req.headers.origin;
      if (origin === undefined || origin === `http://${req.headers.host}`) return next();
      res.writeHead(403, { "content-type": "application/json" });
      res.end('{"error":"cross-origin request"}');
    });
  },
};

export default defineConfig({
  root: here("."),
  base: "./",
  plugins: [sameOriginOnly, paraglideVitePlugin(paraglideOptions), react(), tailwindcss()],
  resolve: { alias: { "@": here("./src") } },
  build: { outDir: here("../dist/ui"), emptyOutDir: true },
  server: {
    proxy: {
      "/api": {
        target,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (req, incoming) => {
            if (incoming.headers.origin !== undefined) req.setHeader("origin", new URL(target).origin);
            if (token) req.setHeader("authorization", `Bearer ${token}`);
          });
        },
      },
    },
  },
  test: {
    name: "ui",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
