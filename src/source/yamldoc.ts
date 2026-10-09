import { Document, isMap, isNode, isScalar, isSeq, parseDocument, type YAMLMap } from "yaml";
import { canonical } from "../hash.ts";
import { own, type Rec } from "../types.ts";
import type { Codec } from "./types.ts";

export const PARSE_OPTIONS = { intAsBigInt: true } as const;
export const STRINGIFY_OPTIONS = { flowCollectionPadding: false } as const;

// a line that could have been wrapped but was not: text with a space in it past the default width of 80
const UNWRAPPED = /^(?=.{81})\s*\S+ \S/m;

// The options to write a file back with. yaml wraps long text at 80 columns, so a file written with long lines
// would be rewrapped throughout by any edit; such a file is written without wrapping.
export const stringifyOptions = (source: string | null) =>
  source !== null && UNWRAPPED.test(source) ? { ...STRINGIFY_OPTIONS, lineWidth: 0 } : STRINGIFY_OPTIONS;
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
    if (current === undefined) map.set(field, doc.createNode(value));
    else if (!updateNode(doc, current, value)) map.set(field, doc.createNode(value));
  }
}

const isPlainMap = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);

// Changes the node in place to hold the value, so the comments and styles on what stays the same are kept.
// False when the node cannot become the value and must be replaced.
function updateNode(doc: Document, node: unknown, value: unknown): boolean {
  if (!isNode(node)) return false;
  if (canonical(node.toJS(doc)) === canonical(value)) return true;
  if (isMap(node) && isPlainMap(value)) {
    for (const pair of node.items.slice()) {
      const key = isScalar(pair.key) ? pair.key.value : pair.key;
      if (!Object.hasOwn(value, String(key))) node.delete(pair.key);
    }
    for (const [key, next] of Object.entries(value)) {
      const current: unknown = node.get(key, true);
      if (current === undefined || !updateNode(doc, current, next)) node.set(key, doc.createNode(next));
    }
    return true;
  }
  if (isSeq(node) && Array.isArray(value)) {
    node.items.splice(value.length);
    value.forEach((next, i) => {
      const current = node.items[i];
      if (current === undefined) node.items.push(doc.createNode(next));
      else if (!updateNode(doc, current, next)) node.items[i] = doc.createNode(next);
    });
    return true;
  }
  if (isScalar(node) && typeof node.value === typeof value && (typeof value !== "object" || value === null)) {
    node.value = value;
    return true;
  }
  return false;
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
      return parsed.doc.toString(stringifyOptions(current));
    }
    return new Document(stripNulls(record)).toString(STRINGIFY_OPTIONS);
  },
};
