import { dirname } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import { type Extract, fileDiff, type HistoryTarget, recordHistory } from "../../githistory.ts";
import { markdownCodec, markdownExt } from "../../source/markdown.ts";
import { PARSE_OPTIONS, yamlCodec } from "../../source/yamldoc.ts";
import { own, type Rec, type TableSpec } from "../../types.ts";
import { type ApiContext, displayPath, tableSpec } from "../context.ts";
import { HttpError } from "../http.ts";
import { wireValue } from "../wire.ts";
import type { Routes } from "./index.ts";
import { insideTable, recordFile } from "./rows.ts";

const CURSOR = /^\d+$/;
const REV = /^(?:[0-9a-f]{40}|[0-9a-f]{64}|wip)$/;

// the record as one version of its file holds it
export function extractor(spec: TableSpec, key: string): Extract {
  if (spec.mode === "list") {
    return (content) => {
      const doc = parseDocument(content, PARSE_OPTIONS);
      if (doc.errors.length > 0) return "unreadable";
      if (doc.contents === null) return null;
      if (!isSeq(doc.contents)) return "unreadable";
      for (const item of doc.contents.items) {
        if (!isMap(item)) continue;
        const record = item.toJS(doc) as Rec;
        const value = own(record, spec.key);
        if (value !== null && value !== undefined && String(value) === key) return record;
      }
      return null;
    };
  }
  const codec =
    spec.codec === "markdown" ? markdownCodec(spec.body ?? "body", markdownExt(spec.glob) ?? ".md") : yamlCodec;
  return (content) => {
    const read = codec.read(content);
    return read.ok ? read.record : "unreadable";
  };
}

function target(ctx: ApiContext, params: Record<string, string>): { spec: TableSpec; key: string; t: HistoryTarget } {
  const spec = tableSpec(ctx, params.table as string);
  const key = params.key as string;
  const row = ctx.store.tableExists(spec.name) ? ctx.store.readRow(spec.name, spec.key, key) : undefined;
  if (!row) throw new HttpError(404, `no record "${key}" in ${spec.name}`);
  const file = recordFile(spec, key);
  if (!insideTable(spec, file)) throw new HttpError(404, `no record "${key}" in ${spec.name}`);
  return { spec, key, t: { dir: spec.mode === "list" ? dirname(spec.path) : spec.path, file } };
}

export const historyRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/tables/:table/rows/:key/history", async ({ params, query }) => {
    const { spec, key, t } = target(ctx, params);
    const cursor = query.get("cursor") ?? undefined;
    if (cursor !== undefined && !CURSOR.test(cursor)) throw new HttpError(400, "invalid cursor");
    const page = await recordHistory(t, extractor(spec, key), { cursor });
    if (page.state !== "ok") return page;
    return {
      ...page,
      entries: page.entries.map((e) => ({
        ...e,
        path: displayPath(ctx.root, e.path),
        ...(e.renamedFrom !== undefined ? { renamedFrom: displayPath(ctx.root, e.renamedFrom) } : {}),
        changes: e.changes.map((c) => ({ path: c.path, from: wireValue(c.from), to: wireValue(c.to) })),
        record: e.record === null ? null : wireValue(e.record),
      })),
    };
  });

  router.add("GET", "/api/tables/:table/rows/:key/history/:sha/diff", async ({ params }) => {
    const rev = params.sha as string;
    if (!REV.test(rev)) throw new HttpError(400, "invalid commit");
    const { t } = target(ctx, params);
    const res = await fileDiff(t, rev);
    if (res.state === "ok") return { text: res.text };
    if (res.state === "error") throw new HttpError(500, res.message);
    throw new HttpError(
      404,
      res.state === "missing" ? `${rev} did not change this record's file` : `no git history (${res.state})`,
    );
  });
};
