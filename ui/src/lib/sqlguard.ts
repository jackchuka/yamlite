import { firstKeyword, stripSql } from "../../../src/serve/sqltext.ts";

export function needsConfirm(sql: string): string | null {
  const keyword = firstKeyword(sql);
  if (keyword === "DROP") return "DROP は元に戻せません。";
  if ((keyword === "DELETE" || keyword === "UPDATE") && !/\bWHERE\b/i.test(stripSql(sql))) {
    return "WHERE がないため、すべての行が対象になります。";
  }
  return null;
}
