import type { ExpandSpec, TableSpec } from "./types.ts";

export interface DeclaredView {
  spec: ExpandSpec;
  // the table or view it expands
  parent: string;
  // 1 for a view of the table itself
  depth: number;
}

// parents before their children
export function declaredViews(table: TableSpec): DeclaredView[] {
  const out: DeclaredView[] = [];
  const walk = (list: ExpandSpec[], parent: string, depth: number) => {
    for (const spec of list) {
      out.push({ spec, parent, depth });
      walk(spec.expand, spec.name, depth + 1);
    }
  };
  walk(table.expand, table.name, 1);
  return out;
}
