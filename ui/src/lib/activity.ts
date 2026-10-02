import type { ChangeOp, ServeEvent } from "./types";

export interface ActivityLine {
  at: string;
  symbol: string;
  tone: "ok" | "warn" | "err" | "muted";
  text: string;
  detail: string;
}

const CHANGE: Record<ChangeOp, { symbol: string; tone: ActivityLine["tone"]; detail: string }> = {
  toDb: { symbol: "M", tone: "warn", detail: "file → DB" },
  toFile: { symbol: "M", tone: "warn", detail: "DB → file" },
  deleteDb: { symbol: "−", tone: "err", detail: "削除 · file → DB" },
  deleteFile: { symbol: "−", tone: "err", detail: "削除 · DB → file" },
};

export function activityLines(events: ServeEvent[]): ActivityLine[] {
  const lines: ActivityLine[] = [];
  for (const e of events) {
    if (e.type === "sync") {
      if (!e.ok) lines.push({ at: e.at, symbol: "✗", tone: "err", text: e.table, detail: e.error ?? "sync failed" });
      for (const c of e.changes) lines.push({ at: e.at, ...CHANGE[c.op], text: `${e.table} / ${c.key}` });
    } else if (e.type === "conflict") {
      lines.push({
        at: e.at,
        symbol: "⚠",
        tone: "err",
        text: `${e.table} / ${e.key}`,
        detail: `コンフリクト（${e.winner} を採用）`,
      });
    } else if (e.type === "error") {
      lines.push({ at: e.at, symbol: "✗", tone: "err", text: e.table ?? "yamlite", detail: e.message });
    } else {
      lines.push({ at: e.at, symbol: "↻", tone: "muted", text: "yamlite.yaml", detail: "設定を再読み込み" });
    }
  }
  return lines.reverse();
}

export function warningLinks(
  warnings: Record<string, string[]>,
): Array<{ table: string; key: string | null; text: string }> {
  return Object.entries(warnings).flatMap(([table, list]) =>
    list.map((w) => {
      const i = w.indexOf(": ");
      const head = i > 0 ? w.slice(0, i) : "";
      return head !== "" && !head.includes(" ")
        ? { table, key: head, text: w.slice(i + 2) }
        : { table, key: null, text: w };
    }),
  );
}
