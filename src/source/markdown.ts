import { Document, isMap } from "yaml";
import { canonical } from "../hash.ts";
import type { Rec } from "../types.ts";
import type { Codec } from "./types.ts";
import { NOT_A_MAPPING, parseRecordFile, STRINGIFY_OPTIONS, stripNulls, updateMap } from "./yamldoc.ts";

export type MarkdownExt = ".md" | ".mdx";

// a files glob ending in *.md or *.mdx makes a Markdown table, whose new files take that extension
export function markdownExt(glob: string | null): MarkdownExt | null {
  if (glob === null) return null;
  if (glob.endsWith(".md")) return ".md";
  if (glob.endsWith(".mdx")) return ".mdx";
  return null;
}
const BOM = "\uFEFF";

export interface FrontMatterSplit {
  bom: string;
  eol: "\n" | "\r\n";
  // null: the file has no front matter block
  front: string | null;
  body: string;
}

// a front matter block opens with a "---" line at the very top and closes at the next "---" line;
// Hugo's TOML (+++) and JSON ({) front matter are recognised only to be refused
export function splitFrontMatter(
  content: string,
): { ok: true; split: FrontMatterSplit } | { ok: false; error: string } {
  const bom = content.startsWith(BOM) ? BOM : "";
  const text = content.slice(bom.length);
  const end = text.search(/\r?\n/);
  const first = end < 0 ? text : text.slice(0, end);
  const eol = end >= 0 && text[end] === "\r" ? "\r\n" : "\n";
  if (first === "+++") return { ok: false, error: "TOML front matter is not supported" };
  if (first.trim() === "{") return { ok: false, error: "JSON front matter is not supported" };
  if (first !== "---") return { ok: true, split: { bom, eol, front: null, body: text } };
  if (end < 0) return { ok: false, error: "front matter is not closed" };
  const rest = text.slice(end + eol.length);
  const close = /^---\r?$/m.exec(rest);
  if (!close) return { ok: false, error: "front matter is not closed" };
  let after = close.index + close[0].length;
  if (rest[after] === "\n") after += 1;
  return { ok: true, split: { bom, eol, front: rest.slice(0, close.index), body: rest.slice(after) } };
}

function bodyText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value);
}

function opensFrontMatter(text: string): boolean {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  return first === "---" || first === "+++" || first.trim() === "{";
}

const withEol = (text: string, eol: string): string => (eol === "\n" ? text : text.replace(/\r?\n/g, eol));

const fresh = (fields: Rec, eol: string): string => withEol(new Document(fields).toString(STRINGIFY_OPTIONS), eol);

// the front matter to write: the old text as is when its fields did not change, so a body edit never reformats it
function frontFor(old: string | null, fields: Rec, keep: (field: string) => boolean, eol: string): string | null {
  const wanted = stripNulls(fields);
  if (old === null) return Object.keys(wanted).length === 0 ? null : fresh(wanted, eol);
  const parsed = parseRecordFile(old);
  if (!parsed.ok) return Object.keys(wanted).length === 0 ? "" : fresh(wanted, eol);
  const current = Object.fromEntries(Object.entries(parsed.record).filter(([field]) => !keep(field)));
  if (canonical(stripNulls(current)) === canonical(wanted)) return old;
  if (!isMap(parsed.doc.contents)) return Object.keys(wanted).length === 0 ? "" : fresh(wanted, eol);
  updateMap(parsed.doc, parsed.doc.contents, fields, keep);
  if (parsed.doc.contents.items.length === 0) return "";
  return withEol(parsed.doc.toString(STRINGIFY_OPTIONS), eol);
}

export function markdownCodec(body: string, ext: MarkdownExt = ".md"): Codec {
  return {
    ext,
    match: ext === ".md" ? /\.md$/i : /\.mdx$/i,
    read(content) {
      const split = splitFrontMatter(content);
      if (!split.ok) return split;
      const { front, body: text } = split.split;
      if (front === null) return { ok: true, record: { [body]: text } };
      const parsed = parseRecordFile(front);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error === NOT_A_MAPPING ? "front matter must be a mapping" : parsed.error };
      }
      if (Object.hasOwn(parsed.record, body)) {
        return { ok: false, error: `front matter has a "${body}" field; set body: to another column name` };
      }
      return { ok: true, record: { ...parsed.record, [body]: text } };
    },
    write(current, record, keep) {
      const { [body]: value, ...fields } = record;
      const text = bodyText(value);
      const split = current === null ? null : splitFrontMatter(current);
      const old = split?.ok ? split.split : null;
      const eol = old?.eol ?? "\n";
      const front = frontFor(old?.front ?? null, fields, keep, eol);
      // a body that opens like front matter would be misread, so an empty block goes in front of it
      const block = front ?? (opensFrontMatter(text) ? "" : null);
      return (old?.bom ?? "") + (block === null ? "" : `---${eol}${block}---${eol}`) + text;
    },
  };
}
