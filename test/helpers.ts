import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "yamlite-"));
}

// a data root with an empty yamlite.yaml, so tables come from the folder conventions
export function dataRoot(): string {
  const root = tmpRoot();
  writeFileSync(join(root, "yamlite.yaml"), "tables: {}\n");
  return root;
}

export function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function read(path: string): string {
  return readFileSync(path, "utf8");
}

export function sql(
  db: string,
  query: string,
  ...params: Array<string | number | null>
): Array<Record<string, unknown>> {
  const conn = new DatabaseSync(db);
  try {
    conn.exec("PRAGMA busy_timeout=5000");
    return conn
      .prepare(query)
      .all(...params)
      .map((row) => ({ ...row }));
  } finally {
    conn.close();
  }
}

export async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = cond();
    } catch {
      ok = false;
    }
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
