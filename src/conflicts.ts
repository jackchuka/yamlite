import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { Rec } from "./types.ts";

export function saveConflict(
  stateDir: string,
  table: string,
  key: string,
  record: Rec | null,
  now = new Date(),
): string {
  const dir = join(stateDir, "conflicts", table);
  mkdirSync(dir, { recursive: true });
  const safeKey = key.replace(/[^\p{L}\p{N}._-]/gu, "_");
  const stamp = now.toISOString().replaceAll(":", "-");
  const content = record === null ? "# deleted on this side\n" : stringify(record);
  for (let n = 0; ; n++) {
    const path = join(dir, `${safeKey}.${stamp}${n === 0 ? "" : `.${n}`}.yaml`);
    try {
      writeFileSync(path, content, { flag: "wx" });
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}
