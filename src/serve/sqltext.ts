// Only good enough to guard the console: it does not parse SQL, it hides comments and string literals
// so that keywords, ";" and table names are looked for in code only.
export function stripSql(sql: string, keepQuoted = true, keepStrings = false): string {
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
      out += (c === "'" && !keepStrings) || !keepQuoted ? "''" : sql.slice(i, j + 1);
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

export const touchesInternal = (sql: string): boolean => /_yamlite_(state|columns|views)\b/i.test(stripSql(sql));

const CREATE_TABLE =
  /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:main|"main")\s*\.\s*)?(?:"((?:[^"]|"")+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))/i;

export function createdTable(sql: string): string | null {
  const m = CREATE_TABLE.exec(stripSql(sql));
  if (!m) return null;
  return m[1]?.replaceAll('""', '"') ?? m[2] ?? m[3] ?? m[4] ?? null;
}

const QUOTED = `"(?:[^"]|"")*"|\`[^\`]*\`|\\[[^\\]]*\\]|'(?:[^']|'')*'`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `name AS (` or `name(cols) AS (`, bare or quoted: a WITH clause that would stand in for one of these names
export function definesName(sql: string, names: Iterable<string>): string | null {
  const code = stripSql(sql, true, true);
  for (const name of names) {
    const e = escapeRe(name);
    const ident = `(?:(?<![\\w$])${e}(?![\\w$])|"${escapeRe(name.replaceAll('"', '""'))}"|\`${e}\`|\\[${e}\\]|'${escapeRe(name.replaceAll("'", "''"))}')`;
    const columns = `\\((?:${QUOTED}|[^)"\`\\['])*\\)`;
    const definition = `${ident}\\s*(?:${columns}\\s*)?AS\\s*(?:NOT\\s+)?(?:MATERIALIZED\\s*)?\\(`;
    // quoted tokens that are not a definition are consumed whole, so text inside a string is never read as code
    const scan = new RegExp(`(${definition})|${QUOTED}`, "gi");
    if (Array.from(code.matchAll(scan)).some((m) => m[1] !== undefined)) return name;
  }
  return null;
}
