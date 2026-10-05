import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open, type Yamlite } from "./index.ts";

export interface Scratch {
  y: Yamlite;
  db: string;
  stateDir: string;
}

// root opened against a database and state in a temporary folder: nothing under root is written
// (no .yamlite/, no lock there, no additions to yamlite.yaml). The folder is removed when fn settles.
export async function withScratch<T>(root: string, prefix: string, fn: (s: Scratch) => Promise<T>): Promise<T> {
  const work = mkdtempSync(join(tmpdir(), prefix));
  const db = join(work, "db.sqlite");
  const stateDir = join(work, "state");
  try {
    const y = await open({ root, db, stateDir, persistConfig: false });
    try {
      return await fn({ y, db, stateDir });
    } finally {
      await y.close();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
