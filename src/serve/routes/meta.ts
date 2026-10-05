import { filesOf } from "../../config.ts";
import { q } from "../../store.ts";
import { displayPath, findView } from "../context.ts";
import { declaredViews } from "../../views.ts";
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
        ...(t.mode === "files" ? { files: filesOf(ctx.root, t) } : {}),
        key: t.key,
        columns,
        formats: t.formats,
        values: t.values,
        required: t.required,
        references: t.references,
        count,
        inDb,
        group: t.group,
      };
    }),
    pages: ctx.y.pages.map((p) => ({
      name: p.name,
      title: p.title,
      path: display(p.path),
      access: p.access,
      sql: p.sql,
      network: p.network,
    })),
    views: ctx.y.tables.flatMap((t) =>
      declaredViews(t).map(({ spec, parent, depth }) => {
        const record = findView(ctx, spec.name)?.record;
        let count = 0;
        try {
          if (record) count = Number(ctx.store.query(`SELECT count(*) AS n FROM ${q(spec.name)}`)[0]?.n ?? 0);
        } catch {
          // a view whose table changed under it counts as empty until the next sync rebuilds it
        }
        return {
          name: spec.name,
          table: t.name,
          parent,
          depth,
          columns: record?.columns ?? {},
          identity: record?.identity ?? [],
          declared: spec.columns,
          references: spec.references,
          values: spec.values,
          required: spec.required,
          count,
          inDb: record !== undefined,
        };
      }),
    ),
  }));
};
