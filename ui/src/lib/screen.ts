export function screenTitle(pathname: string, pages: Array<{ name: string; title: string }>): string {
  const [, kind, raw] = pathname.split("/");
  const name = raw ? decodeURIComponent(raw) : "";
  if (kind === "t" && name) return name;
  if (kind === "p" && name) return pages.find((p) => p.name === name)?.title ?? name;
  if (kind === "sql") return "SQL console";
  if (kind === "sync") return "Sync";
  if (kind === "erd") return "ERD";
  return "yamlite";
}
