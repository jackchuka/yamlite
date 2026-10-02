const KEY = "yamlite-sql-history";
const MAX = 50;

export function loadHistory(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushHistory(sql: string): string[] {
  const next = [sql, ...loadHistory().filter((x) => x !== sql)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // history is a convenience
  }
  return next;
}
