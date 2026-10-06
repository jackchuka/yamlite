import { formatDatetime, instant, parseDatetime } from "../../../src/datetime.ts";
import type { Bound } from "./types";

export interface PickerValue {
  value: string;
  step: number;
}

const PICKER = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const pad = (n: number) => String(n).padStart(2, "0");

// what a datetime-local input can show; null when the text must be edited as text
export function toPicker(text: string): PickerValue | null {
  const d = parseDatetime(text);
  if (!d || (d.fraction !== null && d.fraction.length > 3)) return null;
  const seconds = d.second === null ? "" : `:${d.second}${d.fraction === null ? "" : `.${d.fraction}`}`;
  const step = d.fraction !== null ? 0.001 : d.second !== null ? 1 : 60;
  return { value: `${d.date}T${d.hour}:${d.minute}${seconds}`, step };
}

export function localOffset(date: string, hour: string, minute: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const minutes = -new Date(y, m - 1, d, Number(hour), Number(minute)).getTimezoneOffset();
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// the picked time, spelled the way the current value is: its separator, seconds, fraction digits and offset
export function fromPicker(picker: string, current: string | null, offsetOf = localOffset): string | null {
  const m = PICKER.exec(picker);
  if (!m) return null;
  const [, date, hour, minute, second, fraction] = m as unknown as [string, string, string, string, string?, string?];
  const before = current === null ? null : parseDatetime(current);
  if (!before) {
    return formatDatetime({
      date,
      sep: "T",
      hour,
      minute,
      second: null,
      fraction: null,
      offset: offsetOf(date, hour, minute),
    });
  }
  const digits = before.fraction?.length ?? 0;
  const picked = (fraction ?? "").replace(/0+$/, "").length;
  return formatDatetime({
    date,
    sep: before.sep,
    hour,
    minute,
    second: before.second === null ? null : (second ?? "00"),
    fraction: before.fraction === null ? null : (fraction ?? "").padEnd(digits, "0").slice(0, Math.max(digits, picked)),
    offset: before.offset,
  });
}

const offsetMinutes = (offset: string | null) => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset ?? "");
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
};

// a bound's instant as wall-clock time in the offset the picker is read in; null reads as UTC
export function pickerBound(b: Bound | undefined, offset: string | null): string | undefined {
  if (typeof b !== "string") return undefined;
  const at = instant(b);
  if (at === null) return undefined;
  const iso = new Date(at + offsetMinutes(offset) * 60_000).toISOString();
  const d = parseDatetime(b);
  const seconds = d?.second == null ? "" : d.fraction === null ? iso.slice(16, 19) : iso.slice(16, 23);
  return `${iso.slice(0, 16)}${seconds}`;
}
