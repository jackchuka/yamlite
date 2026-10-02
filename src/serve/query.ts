import { encode } from "../codec.ts";
import { q } from "../store.ts";
import type { ColumnType, DbValue } from "../types.ts";
import { HttpError } from "./http.ts";
import { fromWire } from "./wire.ts";

export const FILTER_OPS = ["eq", "ne", "lt", "lte", "gt", "gte", "contains", "has", "null", "notnull"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface Filter {
  col: string;
  op: FilterOp;
  value?: unknown;
}

export interface RowQuery {
  limit: number;
  offset: number;
  sort: { col: string; dir: "asc" | "desc" } | null;
  filters: Filter[];
  prefix: string | null;
}

const COMPARE: Partial<Record<FilterOp, string>> = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" };

function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new HttpError(400, `not an integer: ${raw}`);
  return Math.min(max, Math.max(min, n));
}

export function parseRowQuery(params: URLSearchParams): RowQuery {
  const limit = intParam(params.get("limit"), 100, 1, 500);
  const offset = intParam(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  let sort: RowQuery["sort"] = null;
  const rawSort = params.get("sort");
  if (rawSort) {
    const i = rawSort.lastIndexOf(":");
    const col = i < 0 ? rawSort : rawSort.slice(0, i);
    const dir = i < 0 ? "asc" : rawSort.slice(i + 1);
    if (dir !== "asc" && dir !== "desc") throw new HttpError(400, `invalid sort direction: ${dir}`);
    sort = { col, dir };
  }
  let filters: Filter[] = [];
  const rawFilter = params.get("filter");
  if (rawFilter) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawFilter);
    } catch {
      throw new HttpError(400, "filter must be a JSON array");
    }
    if (!Array.isArray(parsed)) throw new HttpError(400, "filter must be a JSON array");
    filters = parsed.map((f: Partial<Filter>) => {
      if (typeof f?.col !== "string" || !FILTER_OPS.includes(f.op as FilterOp)) {
        throw new HttpError(400, `invalid filter: ${JSON.stringify(f)}`);
      }
      return { col: f.col, op: f.op as FilterOp, value: f.value };
    });
  }
  const prefix = params.get("prefix");
  return { limit, offset, sort, filters, prefix: prefix === "" ? null : prefix };
}

export function buildWhere(
  query: RowQuery,
  columns: Map<string, ColumnType>,
  keyCol: string,
): { where: string; params: DbValue[] } {
  const parts: string[] = [];
  const params: DbValue[] = [];
  for (const f of query.filters) {
    const type = columns.get(f.col);
    if (type === undefined) throw new HttpError(400, `unknown column: ${f.col}`);
    const c = q(f.col);
    const compare = COMPARE[f.op];
    if (compare) {
      parts.push(`${c} ${compare} ?`);
      params.push(encode(fromWire(f.value, type)));
    } else if (f.op === "contains") {
      parts.push(`instr(${c}, ?) > 0`);
      params.push(String(f.value ?? ""));
    } else if (f.op === "has") {
      if (type !== "JSON") throw new HttpError(400, `"has" needs a JSON column; ${f.col} is ${type}`);
      parts.push(`EXISTS (SELECT 1 FROM json_each(${c}) WHERE json_each.value = ?)`);
      params.push(encode(fromWire(f.value, undefined)));
    } else {
      parts.push(`${c} IS ${f.op === "null" ? "" : "NOT "}NULL`);
    }
  }
  if (query.prefix !== null) {
    // substr instead of LIKE: no wildcards to escape, and case-sensitive like file names
    parts.push(`substr(${q(keyCol)}, 1, ?) = ?`);
    params.push([...query.prefix].length, query.prefix);
  }
  return { where: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "", params };
}

export function orderBy(query: RowQuery, columns: Map<string, ColumnType>, keyCols: readonly string[]): string {
  const keys = keyCols.map(q).join(", ");
  if (!query.sort) return `ORDER BY ${keys}`;
  if (!columns.has(query.sort.col)) throw new HttpError(400, `unknown column: ${query.sort.col}`);
  return `ORDER BY ${q(query.sort.col)} ${query.sort.dir.toUpperCase()}, ${keys}`;
}
