import type { Bound, ColumnFormat, ColumnType, IndexEdit, IndexInfo, Reference, Rules } from "./types";

export function rulesOf(meta: Omit<Rules, "references"> & { references: Reference[] }): Rules {
  return {
    required: [...meta.required],
    values: { ...meta.values },
    formats: { ...meta.formats },
    min: { ...meta.min },
    max: { ...meta.max },
    references: Object.fromEntries(
      meta.references.map((r) => [r.column, r.target ? `${r.table}.${r.target}` : r.table]),
    ),
  };
}

const own = <T>(r: Record<string, T>, k: string): T | undefined => (Object.hasOwn(r, k) ? r[k] : undefined);

function range(min: Bound | undefined, max: Bound | undefined): string | null {
  if (min !== undefined && max !== undefined) return `${min} – ${max}`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}`;
  return null;
}

export function ruleSummary(r: Rules, column: string): string[] {
  const out: string[] = [];
  if (r.required.includes(column)) out.push("required");
  const values = own(r.values, column);
  if (values) out.push(`values ${values.length}`);
  const format = own(r.formats, column);
  if (format) out.push(format);
  const bounds = range(own(r.min, column), own(r.max, column));
  if (bounds) out.push(bounds);
  const ref = own(r.references, column);
  if (ref) out.push(`→ ${ref}`);
  return out;
}

// view warnings are prefixed "<view>: " (the view name contains "__")
const viewPrefix = /^\w+__\w+: /;

export function warningsFor(column: string, warnings: string[], viewName?: string): string[] {
  return warnings.filter((w) => {
    let rest = w;
    if (viewName) {
      const prefix = `${viewName}: `;
      if (!w.startsWith(prefix)) return false;
      rest = w.slice(prefix.length);
    } else if (viewPrefix.test(w)) {
      return false;
    }
    return rest.startsWith(`${column} `) || rest.startsWith(`references.${column}:`);
  });
}

export const boundKind = (type: ColumnType, format: ColumnFormat | undefined): "number" | "date" | "datetime" | null =>
  type === "INTEGER" || type === "REAL" ? "number" : format === "date" || format === "datetime" ? format : null;

export const indexEditOf = (i: IndexInfo): IndexEdit =>
  i.columns ? { columns: [...i.columns], unique: i.unique } : { expr: i.expr ?? "", unique: i.unique };

// as the server's describeIndex writes it
export const describeIndex = (i: IndexEdit): string =>
  `${i.unique ? "unique " : ""}(${"columns" in i ? i.columns.join(", ") : i.expr})`;

const indexId = (i: IndexEdit) =>
  JSON.stringify(["columns" in i ? i.columns : null, "expr" in i ? i.expr : null, i.unique]);

export const sameIndexes = (a: IndexEdit[], b: IndexEdit[]): boolean => sameSet(a.map(indexId), b.map(indexId));

export const sameSet = (a: string[], b: string[]): boolean => {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((x) => set.has(x));
};

// one column's rules, comparable as a string
export const columnRules = (r: Rules, column: string): string =>
  JSON.stringify([
    r.required.includes(column),
    own(r.values, column) ?? null,
    own(r.formats, column) ?? null,
    own(r.min, column) ?? null,
    own(r.max, column) ?? null,
    own(r.references, column) ?? null,
  ]);
