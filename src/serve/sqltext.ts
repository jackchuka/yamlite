// Only good enough to guard the console: it does not parse SQL, it hides comments and string literals
// so that keywords, ";" and table names are looked for in code only.
export function stripSql(sql: string, keepQuoted = true): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] as string;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      out += " ";
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (sql[j] !== close) continue;
        if (close !== "]" && sql[j + 1] === close) {
          j++;
          continue;
        }
        break;
      }
      out += c === "'" || !keepQuoted ? "''" : sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export const statementCount = (sql: string): number =>
  stripSql(sql, false)
    .split(";")
    .filter((s) => s.trim() !== "").length;

export const firstKeyword = (sql: string): string => /^\s*([A-Za-z]+)/.exec(stripSql(sql))?.[1]?.toUpperCase() ?? "";

const READS = new Set(["SELECT", "EXPLAIN", "VALUES"]);
export const isRead = (sql: string): boolean => READS.has(firstKeyword(sql));

export const touchesInternal = (sql: string): boolean => /_yamlite_(state|columns)\b/i.test(stripSql(sql));

const CREATE_TABLE =
  /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:main|"main")\s*\.\s*)?(?:"((?:[^"]|"")+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))/i;

export function createdTable(sql: string): string | null {
  const m = CREATE_TABLE.exec(stripSql(sql));
  if (!m) return null;
  return m[1]?.replaceAll('""', '"') ?? m[2] ?? m[3] ?? m[4] ?? null;
}
