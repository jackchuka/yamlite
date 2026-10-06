import { m } from "@/paraglide/messages.js";

export function screenTitle(pathname: string, pages: Array<{ name: string; title: string }>): string {
  const [, kind, raw] = pathname.split("/");
  const name = raw ? decodeURIComponent(raw) : "";
  if (kind === "t" && name) return name;
  if (kind === "p" && name) return pages.find((p) => p.name === name)?.title ?? name;
  if (kind === "sql") return m.nav_sql_console();
  if (kind === "sync") return m.nav_sync();
  if (kind === "erd") return m.nav_erd();
  return "yamlite";
}
