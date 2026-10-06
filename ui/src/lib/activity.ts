import type { ChangeOp, ServeEvent } from "./types";
import { m } from "@/paraglide/messages.js";

export interface ActivityLine {
  at: string;
  symbol: string;
  tone: "ok" | "warn" | "err" | "muted";
  text: string;
  detail: string;
}

const CHANGE: Record<ChangeOp, { symbol: string; tone: ActivityLine["tone"]; detail: () => string }> = {
  toDb: { symbol: "M", tone: "warn", detail: () => "file → DB" },
  toFile: { symbol: "M", tone: "warn", detail: () => "DB → file" },
  deleteDb: { symbol: "−", tone: "err", detail: m.activity_delete_to_db },
  deleteFile: { symbol: "−", tone: "err", detail: m.activity_delete_to_file },
};

export function activityLines(events: ServeEvent[]): ActivityLine[] {
  const lines: ActivityLine[] = [];
  for (const e of events) {
    if (e.type === "sync") {
      if (!e.ok)
        lines.push({ at: e.at, symbol: "✗", tone: "err", text: e.table, detail: e.error ?? m.activity_sync_failed() });
      for (const c of e.changes) {
        const { detail, ...rest } = CHANGE[c.op];
        lines.push({ at: e.at, ...rest, detail: detail(), text: `${e.table} / ${c.key}` });
      }
    } else if (e.type === "conflict") {
      lines.push({
        at: e.at,
        symbol: "⚠",
        tone: "err",
        text: `${e.table} / ${e.key}`,
        detail: m.activity_conflict({ winner: e.winner }),
      });
    } else if (e.type === "error") {
      lines.push({ at: e.at, symbol: "✗", tone: "err", text: e.table ?? "yamlite", detail: e.message });
    } else {
      lines.push({ at: e.at, symbol: "↻", tone: "muted", text: "yamlite.yaml", detail: m.activity_config_reloaded() });
    }
  }
  return lines.reverse();
}

export interface WarningLink {
  table: string;
  key: string | null;
  view: string | null;
  text: string;
}

// engine warnings about one record start with "<key>: ", and those about an expanded view with "<view>: "
export function warningLinks(
  warnings: Record<string, string[]>,
  views: ReadonlySet<string> = new Set(),
): WarningLink[] {
  return Object.entries(warnings).flatMap(([table, list]) =>
    list.map((w) => {
      const i = w.indexOf(": ");
      const head = i > 0 ? w.slice(0, i) : "";
      if (head === "" || head.includes(" ")) return { table, key: null, view: null, text: w };
      const text = w.slice(i + 2);
      return views.has(head) ? { table, key: null, view: head, text } : { table, key: head, view: null, text };
    }),
  );
}

export function warningsByKey(links: WarningLink[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const w of links) if (w.key !== null) out.set(w.key, [...(out.get(w.key) ?? []), w.text]);
  return out;
}

// how many warnings each table and expanded view has, counted the way the sidebar shows them
export function warningCounts(warnings: Record<string, string[]>, views: ReadonlySet<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of warningLinks(warnings, views)) {
    const name = w.view ?? w.table;
    out.set(name, (out.get(name) ?? 0) + 1);
  }
  return out;
}
