import type { PageAccess } from "../types.ts";

export interface PageRules {
  name: string;
  access: Record<string, PageAccess>;
  sql: boolean;
  network: string[];
  ai: { maxOutputTokens: number } | null;
}

export const PAGE_AI_DEFAULT_TOKENS = 1024;
export const PAGE_AI_MAX_TOKENS = 8192;

export const canRead = (page: PageRules, name: string): boolean => Object.hasOwn(page.access, name);

export const canWrite = (page: PageRules, name: string): boolean =>
  Object.hasOwn(page.access, name) && page.access[name] === "write";

export const writesAnything = (page: PageRules): boolean => Object.values(page.access).includes("write");

export const notInAccess = (name: string): string => `${name} is not in this page's access`;

// SQLite reports a read inside a view under the innermost view's name, so the views a granted view is built on are trusted too
export function trustedViews(page: PageRules, views: ReadonlyArray<{ name: string; parent: string }>): Set<string> {
  const parentOf = new Map(views.map((v) => [v.name, v.parent]));
  const trusted = new Set<string>();
  for (const name of Object.keys(page.access)) {
    for (let v: string | undefined = name; v !== undefined && parentOf.has(v) && !trusted.has(v); v = parentOf.get(v)) {
      trusted.add(v);
    }
  }
  return trusted;
}

export function pageCsp(network: string[]): string {
  const extra = network.map((o) => ` ${o}`).join("");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'${extra}`,
    `style-src 'unsafe-inline'${extra}`,
    `img-src data: blob:${extra}`,
    `font-src data:${extra}`,
    `connect-src${network.length > 0 ? extra : " 'none'"}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

export function accessSummary(page: PageRules): string {
  const parts = Object.entries(page.access).map(([name, level]) => `${name}: ${level}`);
  if (page.sql) parts.push("sql");
  for (const origin of page.network) parts.push(new URL(origin).host);
  if (page.ai) parts.push("AI");
  return parts.length > 0 ? parts.join(" · ") : "no access";
}

// the header shows counts; the full list stays in its tooltip
export function accessBrief(page: PageRules): string {
  const levels = Object.values(page.access);
  const writes = levels.filter((l) => l === "write").length;
  const reads = levels.length - writes;
  const parts: string[] = [];
  if (writes > 0) parts.push(`write ${writes}`);
  if (reads > 0) parts.push(`read ${reads}`);
  if (page.sql) parts.push("SQL");
  const n = page.network.length;
  if (n > 0) parts.push(`${n} ${n === 1 ? "origin" : "origins"}`);
  if (page.ai) parts.push("AI");
  return parts.length > 0 ? parts.join(" · ") : "no access";
}
