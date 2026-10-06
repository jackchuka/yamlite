import { firstKeyword, stripSql } from "../../../src/serve/sqltext.ts";
import { m } from "@/paraglide/messages.js";

export function needsConfirm(sql: string): string | null {
  const keyword = firstKeyword(sql);
  if (keyword === "DROP") return m.sql_confirm_drop();
  if ((keyword === "DELETE" || keyword === "UPDATE") && !/\bWHERE\b/i.test(stripSql(sql))) {
    return m.sql_confirm_no_where();
  }
  return null;
}
