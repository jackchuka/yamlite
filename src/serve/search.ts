import { q } from "../ident.ts";
import type { ColumnType, DbRow, DbValue } from "../types.ts";
import { HttpError } from "./errors.ts";

export interface SearchTable {
  name: string;
  key: string;
  columns: Map<string, ColumnType>;
}

export interface SearchHit {
  table: string;
  key: string;
  label: string | null;
  column: string;
  value: string;
  rank: number;
  total: number;
}

export const MIN_QUERY = 2;
const DEFAULT_PER = 20;
const MAX_PER = 200;

export function parseSearchQuery(params: URLSearchParams): { needle: string; per: number } {
  const needle = params.get("q")?.trim() ?? "";
  if ([...needle].length < MIN_QUERY) throw new HttpError(400, `q needs at least ${MIN_QUERY} characters`);
  const raw = params.get("per");
  if (raw === null) return { needle, per: DEFAULT_PER };
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new HttpError(400, `not an integer: ${raw}`);
  return { needle, per: Math.min(MAX_PER, Math.max(1, n)) };
}

const LABELS = ["title", "name", "label"];

// the record's display name: the first TEXT column named like a title, ignoring case
function labelColumn(t: SearchTable): string | null {
  const named = (want: string) =>
    [...t.columns].find(([c, type]) => c !== t.key && type === "TEXT" && c.toLowerCase() === want)?.[0];
  for (const want of LABELS) {
    const found = named(want);
    if (found) return found;
  }
  return null;
}

const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const text = (column: string) => `CAST(${q(column)} AS TEXT)`;
const contains = (column: string) => `instr(lower(${text(column)}), needle.v) > 0`;

// one SELECT per table; the key column first so a key match is the one reported;
// main. keeps a table named like one of the statement's CTEs from resolving to the CTE
function tableHits(t: SearchTable): string | null {
  const columns = [t.key, ...[...t.columns.keys()].filter((c) => c !== t.key)].filter(
    (c) => t.columns.get(c) !== "BOOLEAN",
  );
  if (columns.length === 0) return null;
  const pick = (then: (c: string) => string) =>
    `CASE ${columns.map((c) => `WHEN ${contains(c)} THEN ${then(c)}`).join(" ")} END`;
  const label = labelColumn(t);
  return (
    `SELECT ${literal(t.name)} AS tbl, ${text(t.key)} AS k, ${label ? text(label) : "NULL"} AS lbl, ` +
    `${pick(literal)} AS col, ${pick(text)} AS val ` +
    `FROM main.${q(t.name)}, needle WHERE ${columns.map(contains).join(" OR ")}`
  );
}

// the needle is bound once through a CTE, so the parameter count does not grow with tables or columns
export function buildSearchSql(
  tables: SearchTable[],
  needle: string,
  per: number,
): { sql: string; params: DbValue[] } | null {
  const selects = tables.map(tableHits).filter((s): s is string => s !== null);
  if (selects.length === 0) return null;
  const sql = `WITH needle(v) AS (SELECT lower(?)),
hits AS (${selects.join(" UNION ALL ")}),
ranked AS (
  SELECT hits.*,
    CASE WHEN lower(k) = needle.v THEN 0
         WHEN substr(lower(k), 1, length(needle.v)) = needle.v THEN 1
         WHEN instr(lower(k), needle.v) > 0 THEN 2
         ELSE 3 END AS grade,
    count(*) OVER (PARTITION BY tbl) AS total
  FROM hits, needle
)
SELECT tbl, k, lbl, col, val, grade, total FROM (
  SELECT ranked.*, row_number() OVER (PARTITION BY tbl ORDER BY grade, k) AS n FROM ranked
) WHERE n <= ? ORDER BY grade, tbl, k`;
  return { sql, params: [needle, per] };
}

export function toSearchHit(row: DbRow): SearchHit {
  return {
    table: String(row.tbl),
    key: String(row.k),
    label: row.lbl === null || row.lbl === undefined ? null : String(row.lbl),
    column: String(row.col),
    value: String(row.val ?? ""),
    rank: Number(row.grade),
    total: Number(row.total),
  };
}
