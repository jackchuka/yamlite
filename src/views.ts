import type { SchemaChange } from "./indexes.ts";
import { inferColumns } from "./schema.ts";
import { q, type Store } from "./store.ts";
import {
  type ColumnType,
  type DbValue,
  type ExpandSpec,
  own,
  type Rec,
  type TableSpec,
  type ViewRecord,
} from "./types.ts";

export interface DeclaredView {
  spec: ExpandSpec;
  // the table or view it expands
  parent: string;
  // 1 for a view of the table itself
  depth: number;
  // the fields from the table's record down to the expanded one
  path: string[];
}

// parents before their children
export function declaredViews(table: TableSpec): DeclaredView[] {
  const out: DeclaredView[] = [];
  const walk = (list: ExpandSpec[], parent: string, path: string[]) => {
    for (const spec of list) {
      const next = [...path, spec.field];
      out.push({ spec, parent, depth: next.length, path: next });
      walk(spec.expand, spec.name, next);
    }
  };
  walk(table.expand, table.name, []);
  return out;
}

export interface IdentityColumn {
  // a column of the parent table or view
  from: string;
  // its name in the view
  as: string;
  type: ColumnType;
}

export interface ViewParent {
  name: string;
  identity: IdentityColumn[];
}

export interface ViewDef {
  sql: string;
  columns: Record<string, ColumnType>;
  identity: string[];
  // the parent of the views declared under this one
  next: ViewParent;
  // each element field's values, to infer the views declared under this one
  fields: Map<string, unknown[]>;
  warnings: string[];
}

const isMap = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const jsonPath = (field: string) => `$."${field.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

// CAST(x AS JSON) converts to a number, so JSON is never cast
function cast(expr: string, declared: ColumnType | undefined): string {
  if (declared === undefined || declared === "JSON") return expr;
  return `CAST(${expr} AS ${declared === "BOOLEAN" ? "INTEGER" : declared})`;
}

export function rootParent(table: TableSpec, keyType: ColumnType): ViewParent {
  return { name: table.name, identity: [{ from: table.key, as: `${table.name}_${table.key}`, type: keyType }] };
}

// `values` are the parent column's values; only arrays and maps produce rows
export function buildView(spec: ExpandSpec, parent: ViewParent, values: readonly unknown[]): ViewDef {
  const containers = values.filter((v): v is unknown[] | Rec => v !== null && typeof v === "object");
  const position = containers.some((v) => !Array.isArray(v)) ? "key" : "idx";
  const elements = containers.flatMap((v) => (Array.isArray(v) ? v : Object.values(v)));
  const maps = elements.filter(isMap);
  const others = elements.filter((e) => e !== null && e !== undefined && !isMap(e));

  const identity = [...parent.identity.map((c) => c.as), position];
  const columns: Record<string, ColumnType> = {};
  const select: string[] = [];
  for (const c of parent.identity) {
    columns[c.as] = c.type;
    select.push(`p.${q(c.from)} AS ${q(c.as)}`);
  }
  columns[position] = position === "idx" ? "INTEGER" : "TEXT";
  select.push(`CAST(e.key AS ${columns[position]}) AS ${q(position)}`);

  const warnings: string[] = [];
  const fields = new Map<string, unknown[]>();
  const declared = (field: string) => own(spec.columns, field);
  const hidden = (field: string) => identity.includes(field) || (field === "value" && others.length > 0);
  const inferred = inferColumns(maps);
  for (const [field, type] of Object.entries(spec.columns)) {
    if (!inferred.has(field) && !hidden(field)) inferred.set(field, type);
  }
  for (const [field, type] of inferred) {
    if (hidden(field)) {
      const by = identity.includes(field) ? "identity" : "value";
      warnings.push(`view ${spec.name}: field "${field}" hidden by the ${by} column`);
      continue;
    }
    columns[field] = declared(field) ?? type;
    // json_extract throws on an element that is a plain string
    const extract = `CASE WHEN e.type = 'object' THEN json_extract(e.value, ${literal(jsonPath(field))}) END`;
    select.push(`${cast(extract, declared(field))} AS ${q(field)}`);
    fields.set(
      field,
      maps.map((m) => own(m, field)),
    );
  }
  if (others.length > 0) {
    columns.value = declared("value") ?? inferColumns(others.map((value) => ({ value }))).get("value") ?? "TEXT";
    select.push(`${cast("CASE WHEN e.type <> 'object' THEN e.value END", declared("value"))} AS "value"`);
  }

  // json_each throws on text that is not JSON and returns a keyless row for a scalar
  const source = `p.${q(spec.field)}`;
  const rows = `CASE WHEN json_valid(${source}) THEN CASE WHEN json_type(${source}) IN ('array', 'object') THEN ${source} END END`;
  const last = identity.length - 1;
  const inherited = parent.identity.map((c) => c.as);
  let ownPosition = `${spec.field}_${position}`;
  for (let n = 2; inherited.includes(ownPosition); n++) ownPosition = `${spec.field}_${position}_${n}`;
  return {
    sql: `CREATE VIEW ${q(spec.name)} AS SELECT ${select.join(", ")} FROM ${q(parent.name)} p, json_each(${rows}) e`,
    columns,
    identity,
    next: {
      name: spec.name,
      identity: identity.map((c, i) => ({
        from: c,
        as: i === last ? ownPosition : c,
        type: columns[c] as ColumnType,
      })),
    },
    fields,
    warnings,
  };
}

export interface ViewPlan {
  changes: SchemaChange[];
  warnings: string[];
}

// integers become bigint so that inference tells INTEGER from REAL, as it does for YAML
function parseJson(value: DbValue | undefined): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value, (_key, v: unknown, context?: { source?: string }) =>
      typeof v === "number" && /^-?\d+$/.test(context?.source ?? "") ? BigInt(context?.source as string) : v,
    );
  } catch {
    return value;
  }
}

// Makes the table's views match its expand declarations. Views yamlite did not register are never touched. A view
// that cannot be created is a warning, the views under it are skipped, and an earlier version of it is dropped.
export function reconcileViews(store: Store, spec: TableSpec, apply: boolean): ViewPlan {
  const plan: ViewPlan = { changes: [], warnings: [] };
  const registered = new Map(store.registeredViews(spec.name).map((v) => [v.name, v]));
  const drop = (name: string) => {
    const doomed = [name];
    for (let i = 0; i < doomed.length; i++) {
      for (const v of registered.values()) if (v.parent === doomed[i]) doomed.push(v.name);
    }
    for (const n of doomed.reverse()) {
      const isView = store.objectType(n) === "view";
      if (apply) {
        if (isView) store.exec(`DROP VIEW ${q(n)}`);
        store.unregisterView(n);
      }
      registered.delete(n);
      if (isView) plan.changes.push({ op: "dropView", name: n, definition: n });
    }
  };
  const wanted = new Set(declaredViews(spec).map((d) => d.spec.name));
  for (const name of registered.keys()) if (registered.has(name) && !wanted.has(name)) drop(name);
  if (spec.expand.length === 0 || !store.tableExists(spec.name)) return plan;

  const walk = (
    list: ExpandSpec[],
    parent: ViewParent,
    typeOf: (field: string) => ColumnType | undefined,
    valuesOf: (field: string) => unknown[],
  ) => {
    for (const e of list) {
      const skip = (reason: string) => {
        plan.warnings.push(`view ${e.name} not created: ${reason}`);
        if (registered.has(e.name)) drop(e.name);
      };
      if (typeOf(e.field) !== "JSON") {
        skip(`no JSON column "${e.field}"`);
        continue;
      }
      const kind = store.objectType(e.name);
      if (kind === "table" || (kind !== null && !registered.has(e.name))) {
        plan.warnings.push(`view ${e.name} not created: a ${kind} with that name is not managed by yamlite`);
        if (registered.has(e.name)) drop(e.name);
        continue;
      }
      const def = buildView(e, parent, valuesOf(e.field));
      plan.warnings.push(...def.warnings);
      const current = store.viewSql(e.name);
      if (current !== def.sql) {
        if (apply) {
          try {
            store.savepoint(() => {
              if (current !== null) store.exec(`DROP VIEW ${q(e.name)}`);
              store.exec(def.sql);
            });
          } catch (err) {
            skip(err instanceof Error ? err.message : String(err));
            continue;
          }
        }
        if (current !== null) plan.changes.push({ op: "dropView", name: e.name, definition: e.name });
        plan.changes.push({ op: "createView", name: e.name, definition: e.name });
      }
      const record: ViewRecord = {
        name: e.name,
        table: spec.name,
        parent: parent.name,
        columns: def.columns,
        identity: def.identity,
      };
      if (apply) store.registerView(record);
      registered.set(e.name, record);
      walk(
        e.expand,
        def.next,
        (f) => own(def.columns, f),
        (f) => def.fields.get(f) ?? [],
      );
    }
  };
  const types = store.columns(spec.name);
  walk(
    spec.expand,
    rootParent(spec, types.get(spec.key) ?? "TEXT"),
    (f) => types.get(f),
    (f) => store.query(`SELECT ${q(f)} AS v FROM ${q(spec.name)}`).map((r) => parseJson(r.v)),
  );
  return plan;
}
