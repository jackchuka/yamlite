import type { TableSearch } from "@/routes";
import type { Reference, TableMeta } from "./types";

// a reference to the target's key opens that record; one to another column lists the rows holding the value
export function referenceSearch(ref: Reference, tables: readonly TableMeta[] | undefined, value: string): TableSearch {
  const key = tables?.find((t) => t.name === ref.table)?.key;
  if (ref.target === undefined || ref.target === key) return { key: value };
  return { filter: [{ col: ref.target, op: "eq", value }] };
}
