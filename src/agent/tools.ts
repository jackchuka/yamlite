import { check } from "../check.ts";
import type { ApiContext } from "../serve/context.ts";
import { readRecord } from "../serve/records.ts";
import { validateNewTable } from "../serve/routes/tables.ts";
import { isPageStatement, statementCount } from "../serve/sqltext.ts";
import { toWire } from "../serve/wire.ts";
import { declaredViews } from "../views.ts";
import { COLUMN_TYPES } from "../types.ts";
import type { McpTool } from "./mcp.ts";
import type { NewTable, Proposal, RecordChange } from "./proposals.ts";

const QUERY_ROWS = 200;
const RECORDS = 100;

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${name} is required`);
  return v;
};

function summary(p: Proposal): string {
  if (p.table)
    return `Proposal ${p.id} created: a new table ${p.table.name}. Nothing is saved until the user applies it. The proposal appears as a card in this same chat panel; tell the user to review the card above and press its apply button, and do not send them elsewhere in the UI.`;
  const tables = [...new Set(p.rows.map((r) => r.table))].map((t) => {
    const rows = p.rows.filter((r) => r.table === t);
    const ops = (["insert", "update", "delete"] as const)
      .map((op) => [op, rows.filter((r) => r.op === op).length] as const)
      .filter(([, n]) => n > 0)
      .map(([op, n]) => `${n} ${op}`)
      .join(", ");
    return `${rows.length} row${rows.length === 1 ? "" : "s"} in ${t} (${ops})`;
  });
  const warn = p.warnings.length > 0 ? ` It would add these warnings: ${p.warnings.join("; ")}.` : "";
  return `Proposal ${p.id} created: ${tables.join(", ")}. Nothing is saved until the user applies it. The proposal appears as a card in this same chat panel; tell the user to review the card above and press its apply button, and do not send them elsewhere in the UI. Do not say the data was changed.${warn}`;
}

export function agentTools(ctx: ApiContext, conversationId: string): McpTool[] {
  const views = () =>
    ctx.y.tables.flatMap((t) => declaredViews(t).map(({ spec, parent }) => ({ name: spec.name, parent })));
  const spec = (name: unknown) => {
    const s = ctx.y.tables.find((t) => t.name === name);
    if (!s) throw new Error(`unknown table: ${String(name)}`);
    return s;
  };
  return [
    {
      name: "schema",
      description:
        "List the tables and views in this yamlite folder: key column, column types, formats, allowed values, required columns, bounds and references. Call this first.",
      inputSchema: { type: "object", properties: {} },
      call: () => ({
        tables: ctx.y.tables.map((t) => ({
          name: t.name,
          mode: t.mode,
          key: t.key,
          columns: ctx.store.tableExists(t.name)
            ? Object.fromEntries(ctx.store.columns(t.name))
            : { [t.key]: "TEXT", ...t.columns },
          formats: t.formats,
          values: t.values,
          required: t.required,
          min: t.min,
          max: t.max,
          references: t.references,
          group: t.group,
        })),
        views: views().map((v) => v.name),
      }),
    },
    {
      name: "query",
      description: `Run one read-only SQL statement (SELECT, WITH … SELECT) over the tables and views. JSON columns can be read with json_each. At most ${QUERY_ROWS} rows are returned.`,
      inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
      call: (a) => {
        const sql = str(a.sql, "sql");
        if (statementCount(sql) > 1) throw new Error("run one statement at a time");
        if (!isPageStatement(sql))
          throw new Error("query only reads; use propose_sql or propose_changes to change data");
        const names = [...ctx.y.tables.map((t) => t.name), ...views().map((v) => v.name)];
        const rules = {
          name: "agent",
          access: Object.fromEntries(names.map((n) => [n, "read" as const])),
          sql: true,
          network: [],
        };
        const r = ctx.pageSql.run(rules, views(), sql, QUERY_ROWS);
        return { columns: r.columns, rows: r.rows.map((row) => toWire(row, new Map())), truncated: r.truncated };
      },
    },
    {
      name: "get_records",
      description: `Read whole records of one table by key (at most ${RECORDS} keys).`,
      inputSchema: {
        type: "object",
        properties: {
          table: { type: "string" },
          keys: { type: "array", items: { type: "string" }, maxItems: RECORDS },
        },
        required: ["table", "keys"],
      },
      call: (a) => {
        const s = spec(a.table);
        if (!Array.isArray(a.keys) || a.keys.length > RECORDS)
          throw new Error(`keys must be an array of at most ${RECORDS} keys`);
        const keys = a.keys.map(String);
        const found = keys.map((k) => [k, readRecord(ctx.store, s, k)] as const);
        return {
          records: found.flatMap(([, r]) => (r ? [r] : [])),
          missing: found.filter(([, r]) => !r).map(([k]) => k),
        };
      },
    },
    {
      name: "propose_changes",
      description:
        "Propose inserting, updating or deleting records. Nothing is saved: the user reviews the diff and applies it in the UI. For update, values holds only the fields to change. Values use JSON types; lists and maps are JSON.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "a short summary the user will read, in the user's language" },
          changes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                table: { type: "string" },
                key: { type: "string" },
                op: { enum: ["insert", "update", "delete"] },
                values: { type: "object" },
              },
              required: ["table", "key", "op"],
            },
          },
        },
        required: ["title", "changes"],
      },
      call: (a) => {
        if (!Array.isArray(a.changes)) throw new Error("changes must be an array");
        return summary(ctx.proposals.fromChanges(conversationId, str(a.title, "title"), a.changes as RecordChange[]));
      },
    },
    {
      name: "propose_sql",
      description:
        "Propose INSERT, UPDATE and DELETE statements (several are fine, separated by ;). They run on a copy that is rolled back; the user sees the resulting row diff and applies it in the UI. Use this for changes that follow a rule.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "a short summary the user will read, in the user's language" },
          sql: { type: "string" },
        },
        required: ["title", "sql"],
      },
      call: (a) => summary(ctx.proposals.fromSql(conversationId, str(a.title, "title"), str(a.sql, "sql"))),
    },
    {
      name: "propose_table",
      description:
        'Propose a new table. mode "files" keeps one YAML file per record in a folder; "list" keeps all records in one YAML file. New columns of existing tables need no proposal: include them in propose_changes values.',
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          name: { type: "string" },
          mode: { enum: ["files", "list"] },
          key: { type: "string" },
          columns: { type: "object", additionalProperties: { enum: [...COLUMN_TYPES] } },
          group: { type: "string" },
        },
        required: ["title", "name", "mode", "key"],
      },
      call: (a) => {
        const { name, mode, key, columns, group } = validateNewTable(ctx, {
          name: a.name,
          mode: a.mode,
          key: a.key,
          columns: a.columns,
          group: a.group,
        });
        const table: NewTable = { name, mode, key, columns, ...(group === null ? {} : { group }) };
        return summary(ctx.proposals.forTable(conversationId, str(a.title, "title"), table));
      },
    },
    {
      name: "check",
      description:
        "Report rule problems in the YAML files: failing tables and warnings for required, allowed values, formats, bounds and references.",
      inputSchema: { type: "object", properties: {} },
      call: async () => {
        const r = await check({ root: ctx.root });
        return {
          ok: r.ok,
          unregisteredTables: r.unregisteredTables,
          tables: r.tables
            .filter((t) => !t.ok || t.warnings.length > 0)
            .map(({ table, error, warnings }) => ({ table, error, warnings })),
        };
      },
    },
  ];
}
