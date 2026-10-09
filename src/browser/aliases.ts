import { fileURLToPath } from "node:url";

const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".mjs";
const here = (name: string) => fileURLToPath(new URL(`./${name}${ext}`, import.meta.url));

// what a bundler maps so yamlite's core runs in a browser worker
export function browserAliases(): { find: RegExp; replacement: string }[] {
  return [
    { find: /^node:sqlite$/, replacement: here("sqlite") },
    { find: /^node:fs$/, replacement: here("fs") },
    { find: /^(node:)?path$/, replacement: here("path") },
    { find: /^node:os$/, replacement: here("os") },
    { find: /^node:crypto$/, replacement: here("crypto") },
    {
      find: /^(node:url|node:child_process|node:stream|node:http|node:util|node:module|@agentclientprotocol\/sdk)$/,
      replacement: here("unavailable"),
    },
    { find: /^chokidar$/, replacement: here("chokidar") },
    { find: /^buffer$/, replacement: fileURLToPath(import.meta.resolve("buffer/index.js")) },
  ];
}
