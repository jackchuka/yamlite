import { q } from "../../store.ts";
import { displayPath } from "../context.ts";
import type { Routes } from "./index.ts";

export const metaRoutes: Routes = (router, ctx) => {
  const display = (path: string) => displayPath(ctx.root, path);
  router.add("GET", "/api/health", () => ({ ok: true }));
  router.add("GET", "/api/meta", () => ({
    root: ctx.root,
    db: display(ctx.dbPath),
    configFile: display(ctx.configFile),
    configError: ctx.hub.configError(),
    tables: ctx.y.tables.map((t) => {
      const inDb = ctx.store.tableExists(t.name);
      const columns = inDb ? Object.fromEntries(ctx.store.columns(t.name)) : { [t.key]: "TEXT", ...t.columns };
      const count = inDb ? Number(ctx.store.query(`SELECT count(*) AS n FROM ${q(t.name)}`)[0]?.n ?? 0) : 0;
      return {
        name: t.name,
        mode: t.mode,
        path: display(t.path),
        key: t.key,
        columns,
        references: t.references,
        count,
        inDb,
      };
    }),
  }));
};
