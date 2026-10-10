import { diffLines, diffWords } from "diff";

export interface Segment {
  text: string;
  mark: boolean;
}
export interface DiffLine {
  kind: "same" | "add" | "del";
  segments: Segment[];
}
export type Hunk = { kind: "lines"; lines: DiffLine[] } | { kind: "skip"; lines: DiffLine[] };

const CONTEXT = 2;
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

export const isLongText = (v: unknown): v is string => typeof v === "string" && (v.includes("\n") || v.length > 120);

const splitLines = (s: string) => s.replace(/\n$/, "").split("\n");
const plain = (kind: DiffLine["kind"], text: string): DiffLine => ({ kind, segments: [{ text, mark: false }] });

// a removed line and the added line that replaced it: mark only the words that differ
export function pair(before: string, after: string): [DiffLine, DiffLine] {
  const parts = diffWords(before, after, { intlSegmenter: segmenter });
  return [
    { kind: "del", segments: parts.filter((p) => !p.added).map((p) => ({ text: p.value, mark: p.removed })) },
    { kind: "add", segments: parts.filter((p) => !p.removed).map((p) => ({ text: p.value, mark: p.added })) },
  ];
}

export function diffText(before: string, after: string): DiffLine[] {
  const parts = diffLines(before, after);
  const out: DiffLine[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lines = splitLines(p.value);
    const next = parts[i + 1];
    if (p.removed && next?.added) {
      const added = splitLines(next.value);
      const n = Math.min(lines.length, added.length);
      const pairs = Array.from({ length: n }, (_, j) => pair(lines[j], added[j]));
      out.push(...pairs.map(([d]) => d), ...lines.slice(n).map((l) => plain("del", l)));
      out.push(...pairs.map(([, a]) => a), ...added.slice(n).map((l) => plain("add", l)));
      i++;
    } else {
      out.push(...lines.map((l) => plain(p.added ? "add" : p.removed ? "del" : "same", l)));
    }
  }
  return out;
}

// keep a few unchanged lines around each change and fold the rest
export function hunks(lines: DiffLine[]): Hunk[] {
  const near = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) near[j] = true;
  });
  const out: Hunk[] = [];
  lines.forEach((l, i) => {
    const kind = near[i] ? "lines" : "skip";
    const last = out.at(-1);
    if (last?.kind === kind) last.lines.push(l);
    else out.push({ kind, lines: [l] });
  });
  return out;
}
