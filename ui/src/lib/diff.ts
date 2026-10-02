import { changedFields } from "./form";
import type { Row } from "./types";

export interface DiffRow {
  field: string;
  winner: unknown;
  saved: unknown;
  same: boolean;
}

export function diffRows(winner: Row | null, saved: Row | null, keyCol?: string): DiffRow[] {
  const w = winner ?? {};
  const s = saved ?? {};
  const changed = new Set(changedFields(w, s));
  const fields = [...new Set([...Object.keys(w), ...Object.keys(s)])].filter((f) => f !== keyCol);
  return fields.map((field) => ({ field, winner: w[field], saved: s[field], same: !changed.has(field) }));
}

export function restoreLabel(winner: "file" | "db" | null): string {
  if (winner === "file") return "DB 側に戻す";
  if (winner === "db") return "ファイル側に戻す";
  return "復元できません";
}
