import { instant, isDate, isDatetime } from "./datetime.ts";
import type { Bound, ColumnFormat } from "./types.ts";

// one value against its column's format and bounds; shared by the sync checks and the UI's form

export function formatProblem(value: unknown, format: ColumnFormat | undefined): string | null {
  if (format === "date") return isDate(value) ? null : "not a date";
  if (format === "datetime") return isDatetime(value) ? null : "not a datetime";
  return null;
}

// a value of the wrong kind is not compared: a broken date already has a format problem
function comparable(value: unknown, format: ColumnFormat | undefined): number | null {
  if (format === "date" || format === "datetime") {
    return formatProblem(value, format) === null ? instant(value as string) : null;
  }
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

const at = (b: Bound) => (typeof b === "number" ? b : (instant(b) as number));

export function boundProblem(
  value: unknown,
  format: ColumnFormat | undefined,
  min: Bound | undefined,
  max: Bound | undefined,
): string | null {
  const v = comparable(value, format);
  if (v === null) return null;
  if (min !== undefined && v < at(min)) return `below min ${min}`;
  if (max !== undefined && v > at(max)) return `above max ${max}`;
  return null;
}
