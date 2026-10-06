import { useInfiniteQuery } from "@tanstack/react-query";
import { getLocale } from "@/paraglide/runtime.js";
import { api } from "./api";
import type { HistoryPage, Row } from "./types";
import { m } from "@/paraglide/messages.js";

export function since(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return m.history_just_now();
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "always" });
  const min = Math.round(s / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const h = Math.round(min / 60);
  if (h < 24) return rtf.format(-h, "hour");
  const d = Math.round(h / 24);
  return d < 30 ? rtf.format(-d, "day") : iso.slice(0, 10);
}

export const valueText = (v: unknown): string =>
  v === null || v === undefined ? m.history_none() : typeof v === "string" ? v : JSON.stringify(v);

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
