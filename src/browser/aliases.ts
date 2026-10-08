import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// what a bundler maps so yamlite's core runs in a browser worker
export function browserAliases(): { find: RegExp; replacement: string }[] {
  return [
    { find: /^node:sqlite$/, replacement: here("./sqlite.ts") },
    { find: /^node:fs$/, replacement: here("./fs.ts") },
    { find: /^(node:)?path$/, replacement: here("./path.ts") },
    { find: /^node:os$/, replacement: here("./os.ts") },
    { find: /^node:crypto$/, replacement: here("./crypto.ts") },
    {
      find: /^(node:url|node:child_process|node:stream|node:http|node:util|node:module|@agentclientprotocol\/sdk)$/,
      replacement: here("./unavailable.ts"),
    },
    { find: /^chokidar$/, replacement: here("./chokidar.ts") },
    { find: /^buffer$/, replacement: here("../../node_modules/buffer/index.js") },
  ];
}
