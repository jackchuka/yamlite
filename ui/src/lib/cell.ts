import type { ColumnFormat, ColumnType } from "./types";

export type CellView =
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "number"; text: string }
  | { kind: "text"; text: string }
  | { kind: "chips"; items: string[]; more: number }
  | { kind: "map"; entries: Array<[string, string]>; more: number }
  | { kind: "nested"; label: string; preview: string };

export const isScalar = (v: unknown): boolean =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const sizeLabel = (v: unknown): string =>
  Array.isArray(v) ? `[${v.length}]` : isMap(v) ? `{${Object.keys(v).length}}` : "";

export const ESM = /^(import\s|export\s+(const|let|var|function|class|default|async|\{|\*))/;
const RULE = /^\s*([-*_]\s*){3,}$|^\s*\|?\s*:?-{3,}/;

// a cell has one line: the text a reader would see, paragraphs split by " · ", without the markup around them
export function markdownExcerpt(source: string): string {
  const blocks: string[] = [];
  let block: string[] = [];
  const flush = () => {
    if (block.length > 0) blocks.push(block.join(" "));
    block = [];
  };
  let fenced = false;
  for (const raw of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      flush();
      continue;
    }
    if (fenced || ESM.test(raw) || RULE.test(raw)) continue;
    // a heading or a table row stands alone; a paragraph's wrapped lines join back up
    const heading = /^\s*(#{1,6}\s|\|)/.test(raw);
    const item = /^\s*([-*+]|\d+[.)])\s/.test(raw);
    if (heading || item) flush();
    const line = raw
      .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/\*([^*\s][^*]*)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s*\|\s*/g, " ")
      .trim();
    if (line === "") flush();
    else block.push(line);
    if (heading) flush();
  }
  flush();
  return blocks.join(" · ");
}

const CHIPS = 3;
const MAP_ENTRIES = 2;

export function cellView(value: unknown, type: ColumnType, format?: ColumnFormat): CellView {
  if (value === null || value === undefined) return { kind: "null" };
  if (typeof value === "boolean") return { kind: "bool", value };
  if (typeof value === "number") return { kind: "number", text: String(value) };
  if (typeof value === "string") {
    if (type === "INTEGER" && /^-?\d+$/.test(value)) return { kind: "number", text: value };
    if (format === "markdown") return { kind: "text", text: markdownExcerpt(value) };
    return { kind: "text", text: value.replaceAll("\n", " ⏎ ") };
  }
  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      return { kind: "chips", items: value.slice(0, CHIPS).map(String), more: Math.max(0, value.length - CHIPS) };
    }
    return { kind: "nested", label: sizeLabel(value), preview: value.map(sizeLabel).join(", ") };
  }
  if (isMap(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0 && entries.every(([, v]) => isScalar(v))) {
      return {
        kind: "map",
        entries: entries.slice(0, MAP_ENTRIES).map(([k, v]) => [k, String(v)]),
        more: Math.max(0, entries.length - MAP_ENTRIES),
      };
    }
    return {
      kind: "nested",
      label: sizeLabel(value),
      preview: entries.map(([k, v]) => (isScalar(v) ? k : `${k}${sizeLabel(v)}`)).join(", "),
    };
  }
  return { kind: "text", text: String(value) };
}
