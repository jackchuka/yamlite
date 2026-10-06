// ISO 8601 dates and datetimes as yamlite.yaml's date and datetime formats accept them; shared with the UI
export interface Datetime {
  date: string;
  sep: "T" | " ";
  hour: string;
  minute: string;
  second: string | null;
  fraction: string | null;
  // "Z", "+09:00", or null when the value has none
  offset: string | null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})([T ])(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-](\d{2}):(\d{2}))?$/;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function isDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= (mo === 2 && leap(y) ? 29 : (DAYS[mo - 1] as number));
}

export function parseDatetime(v: unknown): Datetime | null {
  if (typeof v !== "string") return null;
  const m = DATETIME.exec(v);
  if (!m) return null;
  const [, date, sep, hour, minute, second, fraction, offset, offHour, offMinute] = m;
  if (!isDate(date) || Number(hour) > 23 || Number(minute) > 59) return null;
  if (second !== undefined && Number(second) > 59) return null;
  if (offHour !== undefined && (Number(offHour) > 23 || Number(offMinute) > 59)) return null;
  return {
    date,
    sep: sep as "T" | " ",
    hour: hour as string,
    minute: minute as string,
    second: second ?? null,
    fraction: fraction ?? null,
    offset: offset ?? null,
  };
}

export const isDatetime = (v: unknown): v is string => parseDatetime(v) !== null;

export function formatDatetime(d: Datetime): string {
  const seconds = d.second === null ? "" : `:${d.second}${d.fraction === null ? "" : `.${d.fraction}`}`;
  return `${d.date}${d.sep}${d.hour}:${d.minute}${seconds}${d.offset ?? ""}`;
}

// milliseconds since the epoch; a value without an offset is UTC, a date is its midnight UTC
export function instant(v: string): number | null {
  if (isDate(v)) return Date.parse(`${v}T00:00:00Z`);
  const d = parseDatetime(v);
  if (!d) return null;
  const ms = (d.fraction ?? "").padEnd(3, "0").slice(0, 3);
  return Date.parse(`${d.date}T${d.hour}:${d.minute}:${d.second ?? "00"}.${ms}${d.offset ?? "Z"}`);
}
