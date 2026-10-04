import { Document, isMap, isNode, isScalar, parseDocument, type YAMLMap } from "yaml";
import { canonical } from "../hash.ts";
import { own, type Rec } from "../types.ts";
import type { Codec } from "./types.ts";

export const PARSE_OPTIONS = { intAsBigInt: true } as const;
export const STRINGIFY_OPTIONS = { flowCollectionPadding: false } as const;
export const YAML_EXT = /\.ya?ml$/i;
// the files of a table that was a plain folder: every YAML file below it
export const YAML_GLOB = "**/*.{yaml,yml}";

export const NOT_A_MAPPING = "top-level value must be a mapping";

// the yaml library appends a multi-line excerpt of the source; keep the first line ("… at line L, column C:")
export function firstError(doc: { errors: Array<{ message: string }> }): string {
  return (doc.errors[0]?.message ?? "invalid YAML").split("\n")[0]?.replace(/:$/, "") ?? "invalid YAML";
}

export type Parsed = { ok: true; doc: Document.Parsed; record: Rec } | { ok: false; error: string };

export function parseRecordFile(content: string): Parsed {
  const doc = parseDocument(content, PARSE_OPTIONS);
  if (doc.errors.length > 0) return { ok: false, error: firstError(doc) };
  if (doc.contents === null) return { ok: true, doc, record: {} };
  if (!isMap(doc.contents)) return { ok: false, error: NOT_A_MAPPING };
  return { ok: true, doc, record: doc.toJS() as Rec };
}

export function updateMap(doc: Document, map: YAMLMap, record: Rec, keep: (field: string) => boolean): void {
  for (const pair of map.items.slice()) {
    const field = String(isScalar(pair.key) ? pair.key.value : pair.key);
    if (keep(field)) continue;
    const next = own(record, field);
    if (next !== null && next !== undefined) continue;
    const explicitNull = pair.value === null || (isScalar(pair.value) && pair.value.value === null);
    if (!explicitNull) map.delete(field);
  }
  for (const [field, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    const current: unknown = map.get(field, true);
    const currentJs = isNode(current) ? current.toJS(doc) : current;
    if (current !== undefined && canonical(currentJs) === canonical(value)) continue;
    map.set(field, doc.createNode(value));
  }
}

export function stripNulls(record: Rec): Rec {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== null && v !== undefined));
}

export const yamlCodec: Codec = {
  ext: ".yaml",
  match: YAML_EXT,
  read(content) {
    const parsed = parseRecordFile(content);
    return parsed.ok ? { ok: true, record: parsed.record } : { ok: false, error: parsed.error };
  },
  write(current, record, keep) {
    const parsed = current === null ? null : parseRecordFile(current);
    if (parsed?.ok && isMap(parsed.doc.contents)) {
      updateMap(parsed.doc, parsed.doc.contents, record, keep);
      return parsed.doc.toString(STRINGIFY_OPTIONS);
    }
    return new Document(stripNulls(record)).toString(STRINGIFY_OPTIONS);
  },
};
