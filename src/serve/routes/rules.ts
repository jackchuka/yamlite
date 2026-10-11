import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { resolveConfig } from "../../config.ts";
import { applySchema, configHash, type IndexEdit, RULE_KEYS, type RuleTarget, type Rules } from "../../configfile.ts";
import { writeAtomic } from "../../fsutil.ts";
import { describeIndex, indexName } from "../../indexes.ts";
import { checkReferences } from "../../references.ts";
import { checkRequired } from "../../required.ts";
import { checkBounds, checkFormats } from "../../rulecheck.ts";
import type { TableSpec } from "../../types.ts";
import { checkValues } from "../../values.ts";
import { reconcileViews } from "../../views.ts";
import type { ApiContext } from "../context.ts";
import { HttpError } from "../http.ts";
import { objectBody } from "../write.ts";
import type { Routes } from "./index.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const scalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function targetOf(v: unknown): RuleTarget {
  if (!isRecord(v) || typeof v.table !== "string" || !strings(v.path))
    throw new HttpError(400, "target must be { table, path }", { field: "target" });
  return { table: v.table, path: v.path };
}

function rulesOf(v: unknown): Rules {
  const bad = () =>
    new HttpError(400, "rules must hold required, values, formats, min, max and references", { field: "rules" });
  if (!isRecord(v)) throw bad();
  const { required, values, formats, min, max, references } = v;
  if (!strings(required)) throw bad();
  if (!isRecord(values) || !Object.values(values).every((l) => Array.isArray(l) && l.every(scalar))) throw bad();
  for (const m of [formats, references])
    if (!isRecord(m) || !Object.values(m).every((s) => typeof s === "string")) throw bad();
  for (const m of [min, max])
    if (!isRecord(m) || !Object.values(m).every((b) => typeof b === "number" || typeof b === "string")) throw bad();
  if (Object.keys(v).some((k) => !(RULE_KEYS as readonly string[]).includes(k))) throw bad();
  return v as unknown as Rules;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function indexesOf(v: unknown): IndexEdit[] | undefined {
  if (v === undefined) return undefined;
  const bad = () =>
    new HttpError(400, "indexes must be a list of { columns, unique } or { expr, unique }", { field: "indexes" });
  if (!Array.isArray(v)) throw bad();
  for (const i of v) {
    if (!isRecord(i) || typeof i.unique !== "boolean" || Object.keys(i).length !== 2) throw bad();
    const ok =
      "columns" in i ? Array.isArray(i.columns) && i.columns.length > 0 && i.columns.every(nonEmpty) : nonEmpty(i.expr);
    if (!ok) throw bad();
  }
  return v as IndexEdit[];
}

function viewsOf(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every(nonEmpty))
    throw new HttpError(400, "views must be a list of fields", { field: "views" });
  return v;
}

const warnings = (ctx: ApiContext, spec: TableSpec, all: readonly TableSpec[]) => [
  ...reconcileViews(ctx.store, spec, false).warnings,
  ...checkValues(ctx.store, spec),
  ...checkRequired(ctx.store, spec),
  ...checkFormats(ctx.store, spec),
  ...checkBounds(ctx.store, spec),
  ...checkReferences(ctx.store, spec, all),
];

// a Markdown table's body is markdown without saying so; keep that implied unless the file writes it
function withoutImpliedBody(text: string, spec: TableSpec, target: RuleTarget, rules: Rules): Rules {
  const body = spec.body;
  if (target.path.length > 0 || body === null || rules.formats[body] !== "markdown") return rules;
  if (parseDocument(text).getIn(["tables", target.table, "formats", body]) !== undefined) return rules;
  const { [body]: _, ...formats } = rules.formats;
  return { ...rules, formats };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// the candidate file and what it does to the current data's warnings; writes nothing
function evaluate(ctx: ApiContext, body: unknown) {
  const b = objectBody(body, "body");
  const target = targetOf(b.target);
  const rules = rulesOf(b.rules);
  const indexes = indexesOf(b.indexes);
  const views = viewsOf(b.views);
  if (indexes !== undefined && target.path.length > 0)
    throw new HttpError(400, "indexes belong to a table, not a view", { field: "indexes" });
  if (typeof b.base !== "string") throw new HttpError(400, "base is required", { field: "base" });
  const text = readFileSync(ctx.configFile, "utf8");
  if (configHash(text) !== b.base)
    throw new HttpError(409, "yamlite.yaml changed since editing started", { current: configHash(text) });
  const current = ctx.y.tables.find((t) => t.name === target.table);
  if (!current) throw new HttpError(404, `unknown table: ${target.table}`);
  let next: string | null;
  try {
    next = applySchema(text, target, { rules: withoutImpliedBody(text, current, target, rules), indexes, views });
  } catch (e) {
    throw new HttpError(/^unknown (table|view)/.test(message(e)) ? 404 : 400, message(e));
  }
  let tables: readonly TableSpec[] = ctx.y.tables;
  if (next !== null) {
    try {
      tables = resolveConfig({ root: ctx.root, db: ctx.dbPath, configText: next }).tables;
    } catch (e) {
      throw new HttpError(400, message(e));
    }
  }
  const candidate = tables.find((t) => t.name === target.table) ?? current;
  const before = warnings(ctx, current, ctx.y.tables);
  const after = warnings(ctx, candidate, tables);
  const named = (spec: TableSpec) => new Map(spec.indexes.map((i) => [indexName(spec.name, i), describeIndex(i)]));
  const [had, has] = [named(current), named(candidate)];
  return {
    text,
    next,
    result: {
      added: after.filter((w) => !before.includes(w)),
      removed: before.filter((w) => !after.includes(w)),
      indexes: {
        added: [...has].filter(([n]) => !had.has(n)).map(([, d]) => d),
        removed: [...had].filter(([n]) => !has.has(n)).map(([, d]) => d),
      },
      changed: next !== null,
    },
  };
}

export const rulesRoutes: Routes = (router, ctx) => {
  router.add("POST", "/api/rules/preview", ({ body }) => evaluate(ctx, body).result);

  router.add("PUT", "/api/rules", ({ body }) => {
    ctx.proposals.assertIdle();
    const { text, next, result } = evaluate(ctx, body);
    if (next !== null) {
      writeAtomic(ctx.configFile, next);
      ctx.reloadConfig();
    }
    return { ...result, base: configHash(next ?? text) };
  });
};
