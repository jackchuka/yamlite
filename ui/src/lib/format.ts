import { getLocale } from "@/paraglide/runtime.js";

const time = { hour: "2-digit", minute: "2-digit" } as const;

export const formatTime = (iso: string): string => new Date(iso).toLocaleTimeString(getLocale(), time);

export const formatClock = (iso: string): string => new Date(iso).toLocaleTimeString(getLocale());

export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return formatTime(iso);
  return d.toLocaleString(getLocale(), { month: "numeric", day: "numeric", ...time });
}

export function formatAgo(iso: string | null, now: number): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "always" });
  return s < 60 ? rtf.format(-s, "second") : rtf.format(-Math.round(s / 60), "minute");
}

export const formatNumber = (n: number): string => n.toLocaleString(getLocale());
