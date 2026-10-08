import { readFileSync } from "node:fs";

// guide.md sits next to this module in src/ and, copied by tsdown, in dist/
export function guide(): string {
  return readFileSync(new URL("./guide.md", import.meta.url), "utf8");
}
