import type { ColumnType, Meta, Reference, TableSchema } from "./types";

export interface ErdColumn {
  name: string;
  type: ColumnType;
  key: boolean;
  ref: boolean;
  problems: string[];
}

export interface ErdNode {
  id: string;
  kind: "table" | "view";
  name: string;
  count: number;
  warnings: number;
  columns: ErdColumn[];
}

export interface ErdEdge {
  id: string;
  kind: "ref" | "parent";
  source: string;
  sourceColumn?: string;
  target: string;
  targetColumn?: string;
  broken: boolean;
}

export interface Erd {
  nodes: ErdNode[];
  edges: ErdEdge[];
}

export const TARGET_MISSING = "target not found";

interface Source {
  kind: ErdNode["kind"];
  name: string;
  count: number;
  columns: Record<string, ColumnType>;
  keys: string[];
  references: Reference[];
  problems: (column: string) => string[];
}

// the schema route files a problem under a column when it starts with "<column> " or "references.<column>:"
const about = (column: string) => (p: string) => p.startsWith(`${column} `) || p.startsWith(`references.${column}:`);

// a view's reference problems sit in its root table's schema, prefixed with "<view>: "
function viewProblems(schema: TableSchema | undefined, view: string): string[] {
  const prefix = `${view}: `;
  const all = schema?.views.find((v) => v.name === view)?.problems ?? [];
  return all.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
}

// key columns first, then the rest in their own order
function ordered(columns: Record<string, ColumnType>, keys: string[]): Array<[string, ColumnType]> {
  const entries = Object.entries(columns);
  return [...keys.flatMap((k) => entries.filter(([c]) => c === k)), ...entries.filter(([c]) => !keys.includes(c))];
}

export function buildErd(
  meta: Meta,
  schemas: ReadonlyMap<string, TableSchema>,
  warnings: ReadonlyMap<string, number>,
  opts: { views: boolean },
): Erd {
  const sources: Source[] = meta.tables.map((t) => ({
    kind: "table",
    name: t.name,
    count: t.count,
    columns: t.columns,
    keys: [t.key],
    references: t.references,
    problems: (column) => schemas.get(t.name)?.references.find((r) => r.column === column)?.problems ?? [],
  }));
  if (opts.views) {
    for (const v of meta.views) {
      const problems = viewProblems(schemas.get(v.table), v.name);
      sources.push({
        kind: "view",
        name: v.name,
        count: v.count,
        columns: v.columns,
        keys: v.identity,
        references: v.references,
        problems: (column) => problems.filter(about(column)),
      });
    }
  }

  const tables = new Map(meta.tables.map((t) => [t.name, t]));
  const nodes: ErdNode[] = [];
  const edges: ErdEdge[] = [];
  for (const s of sources) {
    const columns = ordered(s.columns, s.keys).map(([name, type]): ErdColumn => {
      const key = s.keys.includes(name);
      const ref = s.references.find((r) => r.column === name);
      if (!ref) return { name, type, key, ref: false, problems: [] };
      let problems = s.problems(name);
      const target = tables.get(ref.table);
      const targetColumn = ref.target ?? target?.key;
      if (target && targetColumn !== undefined && Object.hasOwn(target.columns, targetColumn)) {
        edges.push({
          id: `ref:${s.name}.${name}`,
          kind: "ref",
          source: s.name,
          sourceColumn: name,
          target: target.name,
          targetColumn,
          broken: problems.length > 0,
        });
      } else if (problems.length === 0) {
        problems = [TARGET_MISSING];
      }
      return { name, type, key, ref: true, problems };
    });
    nodes.push({
      id: s.name,
      kind: s.kind,
      name: s.name,
      count: s.count,
      warnings: warnings.get(s.name) ?? 0,
      columns,
    });
  }
  if (opts.views) {
    for (const v of meta.views) {
      edges.push({ id: `parent:${v.name}`, kind: "parent", source: v.name, target: v.parent, broken: false });
    }
  }
  return { nodes, edges };
}
