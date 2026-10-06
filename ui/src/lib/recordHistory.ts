import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { HistoryPage, Row } from "./types";

export function since(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "たった今";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 時間前`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} 日前` : iso.slice(0, 10);
}

export const valueText = (v: unknown): string =>
  v === null || v === undefined ? "（なし）" : typeof v === "string" ? v : JSON.stringify(v);

// defineProperty, so a field named __proto__ stays a field instead of replacing the prototype
const put = (row: Row, field: string, value: unknown) =>
  Object.defineProperty(row, field, { value, enumerable: true, writable: true, configurable: true });

// the draft that puts an older version's values back; what that version lacks is cleared, the key stays
export function restoreDraft(current: Row, record: Row, keyColumn: string): Row {
  const next: Row = {};
  for (const field of Object.keys(current)) put(next, field, null);
  for (const [field, value] of Object.entries(record)) put(next, field, value);
  put(next, keyColumn, current[keyColumn]);
  return next;
}

export function historyCount(pages: HistoryPage[] | undefined): string | null {
  const last = pages?.at(-1);
  if (!pages || !last || last.state !== "ok") return null;
  const n = pages.reduce(
    (sum, p) => sum + (p.state === "ok" ? p.entries.filter((e) => e.kind === "commit").length : 0),
    0,
  );
  return last.next === null ? String(n) : `${n}+`;
}

export function useRecordHistory(table: string, key: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["history", table, key],
    queryFn: ({ pageParam }) => api.history(table, key, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.state === "ok" ? (last.next ?? undefined) : undefined),
    enabled,
  });
}
