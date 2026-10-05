import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { withScratch } from "./scratch.ts";
import { isPageStatement, statementCount } from "./serve/sqltext.ts";
import type { DbValue } from "./types.ts";

export interface QueryResult {
  columns: string[];
  rows: DbValue[][];
  truncated: boolean;
  // sync failures and warnings, prefixed with their table; a table that failed is missing from the throwaway database
  warnings: string[];
}

export interface QueryOptions {
  root?: string;
  db?: string;
  sql: string;
  // 0 means no limit
  limit?: number;
}

const DEFAULT_LIMIT = 1000;

function run(path: string, sql: string, limit: number): Omit<QueryResult, "warnings"> {
  const conn = new DatabaseSync(path, { readOnly: true });
  try {
    const stmt = conn.prepare(sql);
    stmt.setReadBigInts(true);
    // rows as arrays, so that two columns of the same name both survive
    stmt.setReturnArrays(true);
    const columns = stmt.columns().map((c) => c.name);
    const rows: DbValue[][] = [];
    let truncated = false;
    for (const row of stmt.iterate()) {
      if (limit > 0 && rows.length === limit) {
        truncated = true;
        break;
      }
      rows.push(row as unknown as DbValue[]);
    }
    return { columns, rows, truncated };
  } finally {
    conn.close();
  }
}

// one read-only statement, against the YAML synced into a throwaway database, or against db as it is
export async function query(opts: QueryOptions): Promise<QueryResult> {
  const count = statementCount(opts.sql);
  if (count === 0) throw new Error("no statement to run");
  if (count > 1) throw new Error("run one statement at a time");
  if (!isPageStatement(opts.sql)) throw new Error("query only reads; use sqlite3 or the web UI to write");
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (opts.db !== undefined) {
    const path = resolve(opts.db);
    if (!existsSync(path)) throw new Error(`no database at ${path}`);
    return { ...run(path, opts.sql, limit), warnings: [] };
  }
  return withScratch(resolve(opts.root ?? "."), "yamlite-query-", async ({ y, db }) => {
    const results = await y.sync();
    const warnings = results.flatMap((r) => [
      ...(r.ok ? [] : [`${r.table}: ${r.error ?? "failed"}`]),
      ...r.warnings.map((w) => `${r.table}: ${w}`),
    ]);
    return { ...run(db, opts.sql, limit), warnings };
  });
}

const cellText = (v: DbValue): string =>
  v === null ? "" : v instanceof Uint8Array ? `<${v.length} bytes>` : String(v).replace(/\r?\n/g, "↵");

const isWide = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1f64f) ||
  (cp >= 0x1f900 && cp <= 0x1f9ff) ||
  (cp >= 0x20000 && cp <= 0x3fffd);

const displayWidth = (text: string): number => {
  let w = 0;
  for (const ch of text) w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  return w;
};

export function formatTable(r: QueryResult): string {
  const cells = r.rows.map((row) => row.map(cellText));
  const widths = r.columns.map((c, i) => Math.max(displayWidth(c), ...cells.map((row) => displayWidth(row[i] ?? ""))));
  const line = (values: string[]) =>
    values
      .map((v, i) => v + " ".repeat(Math.max(0, (widths[i] ?? 0) - displayWidth(v))))
      .join("  ")
      .trimEnd();
  return [line(r.columns), line(widths.map((w) => "-".repeat(w))), ...cells.map(line)].join("\n");
}

// a repeated column name gets _2, _3, … that no other column has, so that no value is lost
function uniqueNames(columns: string[]): string[] {
  const taken = new Set(columns);
  const seen = new Set<string>();
  return columns.map((c) => {
    let name = c;
    for (let n = 2; seen.has(name); n++) {
      name = `${c}_${n}`;
      if (taken.has(name)) name = c;
    }
    seen.add(name);
    return name;
  });
}

const jsonValue = (v: DbValue): unknown => {
  if (typeof v === "bigint")
    return v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER ? Number(v) : String(v);
  if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  return v;
};

export function formatJson(r: QueryResult): string {
  const names = uniqueNames(r.columns);
  return JSON.stringify(
    r.rows.map((row) => Object.fromEntries(names.map((name, i) => [name, jsonValue(row[i] ?? null)]))),
    null,
    2,
  );
}

const csvCell = (v: DbValue): string => {
  if (v === null) return "";
  const text = v instanceof Uint8Array ? Buffer.from(v).toString("base64") : String(v);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function formatCsv(r: QueryResult): string {
  const lines = [r.columns.map((c) => csvCell(c)), ...r.rows.map((row) => row.map(csvCell))];
  return `${lines.map((l) => l.join(",")).join("\n")}\n`;
}
