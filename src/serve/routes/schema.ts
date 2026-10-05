import { filesOf } from "../../config.ts";
import { describeIndex, indexName, MANAGED_PREFIX } from "../../indexes.ts";
import { checkReferences } from "../../references.ts";
import { displayPath, findView, tableSpec } from "../context.ts";
import { declaredViews, reconcileViews } from "../../views.ts";
import type { Routes } from "./index.ts";

export const schemaRoutes: Routes = (router, ctx) => {
  // separate from /api/meta: reference checks query every row, so they run only when the panel asks
  router.add("GET", "/api/tables/:table/schema", ({ params }) => {
    const spec = tableSpec(ctx, params.table as string);
    const { store } = ctx;
    const inDb = store.tableExists(spec.name);
    const problems = checkReferences(store, spec, ctx.y.tables);
    // a dry run: only the warnings, which say why a view is not there
    const viewWarnings = inDb ? reconcileViews(store, spec, false).warnings : [];
    const built = inDb ? store.managedIndexes(spec.name) : new Set<string>();
    const others = inDb
      ? store
          .query(
            "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name",
            spec.name,
          )
          .map((r) => String(r.name))
          .filter((name) => !name.startsWith(MANAGED_PREFIX))
      : [];
    return {
      name: spec.name,
      mode: spec.mode,
      path: displayPath(ctx.root, spec.path),
      ...(spec.mode === "files" ? { files: filesOf(ctx.root, spec) } : {}),
      key: spec.key,
      inDb,
      columns: inDb ? Object.fromEntries(store.columns(spec.name)) : { [spec.key]: "TEXT", ...spec.columns },
      declared: spec.columns,
      values: spec.values,
      required: spec.required,
      references: spec.references.map((r) => {
        const target = r.target ?? ctx.y.tables.find((t) => t.name === r.table)?.key ?? "id";
        return {
          column: r.column,
          table: r.table,
          target,
          problems: problems.filter((p) => p.startsWith(`${r.column} `) || p.startsWith(`references.${r.column}:`)),
        };
      }),
      indexes: spec.indexes.map((i) => {
        const name = indexName(spec.name, i);
        return {
          name,
          definition: describeIndex(i),
          columns: i.columns,
          expr: i.expr,
          unique: i.unique,
          inDb: built.has(name),
        };
      }),
      otherIndexes: others,
      views: declaredViews(spec).map(({ spec: view, parent, depth }) => {
        const record = findView(ctx, view.name)?.record;
        return {
          name: view.name,
          parent,
          depth,
          columns: record?.columns ?? {},
          identity: record?.identity ?? [],
          inDb: record !== undefined,
          problems: [
            ...viewWarnings.filter((w) => w.startsWith(`view ${view.name} `) || w.startsWith(`view ${view.name}:`)),
            ...problems.filter((p) => p.startsWith(`${view.name}: `)),
          ],
        };
      }),
    };
  });
};
