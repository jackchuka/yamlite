import { homedir } from "node:os";
import { relative } from "node:path";
import { styleText } from "node:util";
import type { ChangeOp, ConflictInfo, TableResult } from "./engine.ts";
import type { SchemaChange } from "./indexes.ts";

type Style = Parameters<typeof styleText>[0];
export type Painter = (style: Style, text: string) => string;

export const plain: Painter = (_style, text) => text;

// styleText drops colors when the stream is not a TTY or NO_COLOR is set.
export const painter =
  (stream: NodeJS.WriteStream): Painter =>
  (style, text) =>
    styleText(style, text, { stream });

const MIN_SUMMARY_WIDTH = 38;
const WATCH_LABEL_WIDTH = 10;

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function displayPath(path: string, home = homedir()): string {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

const changeCount = (r: TableResult) => r.toDb + r.toFile + r.deletedDb + r.deletedFile;

function schemaCounts(schema: SchemaChange[]): string[] {
  const columns = schema.filter((c) => c.op === "alterColumn" || c.op === "dropColumn").length;
  const indexes = schema.length - columns;
  return [
    columns > 0 ? plural(columns, "column change") : "",
    indexes > 0 ? plural(indexes, "index change") : "",
  ].filter(Boolean);
}

function schemaDetail(c: SchemaChange, paint: Painter, mode: "status" | "sync"): string {
  if (c.op === "dropColumn")
    return `${paint("red", "−")} column ${c.name} ${paint("dim", "(removed from yamlite.yaml)")}`;
  if (c.op === "alterColumn") {
    const note = mode === "status" ? "table will be rebuilt" : "table rebuilt";
    return `${paint("cyan", "↻")} column ${c.name} ${c.definition} ${paint("dim", `(${note})`)}`;
  }
  return c.op === "createIndex"
    ? `${paint("green", "+")} index ${c.definition}`
    : `${paint("red", "−")} index ${c.definition}`;
}

function summary(r: TableResult): string {
  const parts = [
    r.toDb > 0 ? `${r.toDb} → db` : "",
    r.toFile > 0 ? `${r.toFile} → file` : "",
    r.deletedDb > 0 ? `${plural(r.deletedDb, "row")} deleted` : "",
    r.deletedFile > 0 ? `${plural(r.deletedFile, "file")} deleted` : "",
    r.conflicts.length > 0 ? plural(r.conflicts.length, "conflict") : "",
    ...schemaCounts(r.schema),
    r.registered.length > 0 ? plural(r.registered.length, "new column") : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "in sync";
}

function resolution(c: ConflictInfo, root: string): string {
  const loser = c.winner === "db" ? "file" : "db";
  const saved = c.savedTo ? ` · ${loser} version saved to ${relative(root, c.savedTo)}` : "";
  return `kept ${c.winner}${saved}`;
}

function conflictText(c: ConflictInfo, root: string, done: boolean): string {
  return `changed on both sides · ${done ? resolution(c, root) : `${c.winner} will win`}`;
}

export interface ReportOptions {
  mode: "status" | "sync";
  root: string;
  paint: Painter;
  elapsedMs?: number;
}

export function report(results: TableResult[], { mode, root, paint, elapsedMs = 0 }: ReportOptions): string {
  const nameWidth = Math.max(0, ...results.map((r) => r.table.length));
  const summaryWidth = Math.max(MIN_SUMMARY_WIDTH, ...results.map((r) => summary(r).length + 2));
  const indent = " ".repeat(2 + 1 + 1 + nameWidth + 3);
  const lines = [`${paint("bold", "yamlite")} ${paint("dim", `· ${displayPath(root)}`)}`, ""];

  for (const r of results) {
    const name = r.table.padEnd(nameWidth);
    if (!r.ok) {
      lines.push(`  ${paint("red", "✗")} ${name}   ${paint("red", r.error ?? "failed")}`);
      continue;
    }
    const pending = mode === "status" && (changeCount(r) > 0 || r.schema.length > 0 || r.registered.length > 0);
    const icon = pending ? paint("yellow", "●") : paint("green", "✓");
    const records = paint("dim", plural(r.records, "record"));
    lines.push(`  ${icon} ${name}   ${summary(r).padEnd(summaryWidth)}${records}`);
    for (const c of r.schema) lines.push(`${indent}${schemaDetail(c, paint, mode)}`);
    const note = mode === "status" ? "will be added to yamlite.yaml" : "added to yamlite.yaml";
    for (const c of r.registered) {
      lines.push(`${indent}${paint("green", "+")} column ${c.column} ${c.type} ${paint("dim", `(${note})`)}`);
    }
    for (const w of r.warnings) lines.push(`${indent}${paint("yellow", "!")} ${w}`);
    for (const c of r.conflicts) {
      lines.push(`${indent}${paint("yellow", "⚠")} ${c.key}: ${conflictText(c, root, mode === "sync")}`);
    }
  }

  const changes = results.reduce((n, r) => n + changeCount(r), 0);
  const newColumns = results.reduce((n, r) => n + r.registered.length, 0);
  const work = [
    changes > 0 ? plural(changes, "change") : "",
    ...schemaCounts(results.flatMap((r) => r.schema)),
    newColumns > 0 ? plural(newColumns, "new column") : "",
  ].filter(Boolean);
  const conflicts = results.reduce((n, r) => n + r.conflicts.length, 0);
  const errors = results.filter((r) => !r.ok).length;
  const extras = [
    conflicts > 0 ? plural(conflicts, "conflict") : "",
    errors > 0 ? paint("red", plural(errors, "error")) : "",
  ].filter(Boolean);

  let footer: string;
  if (mode === "status") {
    if (work.length === 0 && errors === 0) footer = paint("green", "Everything is in sync");
    else {
      const head = work.length > 0 ? `${work.join(" · ")} pending` : "no changes pending";
      const hint = work.length > 0 ? [paint("dim", "run yamlite sync to apply")] : [];
      footer = [head, ...extras, ...hint].join(" · ");
    }
  } else {
    const head = `Synced ${plural(results.length, "table")} in ${Math.round(elapsedMs)}ms`;
    footer = [head, ...(work.length > 0 ? work : ["no changes"]), ...extras].join(" · ");
  }
  lines.push("", `  ${footer}`);
  return lines.join("\n");
}

export function watchHeader(tables: string[], root: string, paint: Painter): string {
  const names = tables.length > 0 ? tables.join(", ") : "(no tables)";
  return `${paint("bold", "yamlite")} · watching ${names} in ${displayPath(root)} ${paint("dim", "· Ctrl-C to stop")}`;
}

const clock = (now: Date) =>
  [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");

export function reloadLine(tables: string[], now: Date, paint: Painter): string {
  const names = tables.length > 0 ? tables.join(", ") : "(no tables)";
  return `  ${paint("dim", clock(now))}  ${paint("cyan", "↻ reloaded")} config · watching ${names}`;
}

const OP_LABEL: Record<ChangeOp, [Style, string]> = {
  toDb: ["cyan", "→ db"],
  toFile: ["cyan", "→ file"],
  deleteDb: ["red", "− row"],
  deleteFile: ["red", "− file"],
};

export interface WatchEventOptions {
  root: string;
  now: Date;
  paint: Painter;
  quiet: boolean;
  nameWidth?: number;
}

export function watchEvents(r: TableResult, { root, now, paint, quiet, nameWidth = 0 }: WatchEventOptions): string[] {
  const time = clock(now);
  const prefix = `  ${paint("dim", time)}  ${r.table.padEnd(nameWidth)}  `;
  const line = (style: Style, label: string, text: string) =>
    `${prefix}${paint(style, label.padEnd(WATCH_LABEL_WIDTH))}  ${text}`;

  if (!r.ok) return [line("red", "✗ error", r.error ?? "failed")];
  const lines: string[] = [];
  if (!quiet) {
    for (const c of r.changes) lines.push(line(OP_LABEL[c.op][0], OP_LABEL[c.op][1], c.key));
    for (const c of r.schema) {
      if (c.op === "alterColumn") lines.push(line("cyan", "↻ column", `${c.name} ${c.definition}`));
      else if (c.op === "dropColumn") lines.push(line("red", "− column", c.name));
      else if (c.op === "createIndex") lines.push(line("green", "+ index", c.definition));
      else lines.push(line("red", "− index", c.definition));
    }
    for (const c of r.registered) lines.push(line("green", "+ column", `${c.column} ${c.type}`));
  }
  for (const c of r.conflicts) lines.push(line("yellow", "⚠ conflict", `${c.key} · ${resolution(c, root)}`));
  if (!quiet) for (const w of r.warnings) lines.push(line("yellow", "! warning", w));
  return lines;
}
