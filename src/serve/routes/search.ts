import { buildSearchSql, parseSearchQuery, toSearchHit } from "../search.ts";
import type { Routes } from "./index.ts";

export const searchRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/search", ({ query }) => {
    const { needle, per } = parseSearchQuery(query);
    const tables = ctx.y.tables
      .filter((t) => ctx.store.tableExists(t.name))
      .map((t) => ({ name: t.name, key: t.key, columns: ctx.store.columns(t.name) }));
    const built = buildSearchSql(tables, needle, per);
    if (!built) return { hits: [] };
    return { hits: ctx.store.query(built.sql, ...built.params).map(toSearchHit) };
  });
};
