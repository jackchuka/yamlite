import { ReviewRefused } from "../../git/driver.ts";
import { isAbsolute, relative, resolve } from "node:path";
import { canonical } from "../../hash.ts";
import { own, type Rec } from "../../types.ts";
import { tableSpec } from "../context.ts";
import { headRecord, type RecordChange, recordChanges } from "../gitrecords.ts";
import { deleteRecord, insertRecord, readRecord, updateRecord } from "../records.ts";
import { wireValue } from "../wire.ts";
import { HttpError } from "../http.ts";
import { assertSynced, objectBody, writeTx } from "../write.ts";
import type { Routes } from "./index.ts";

function reviewBody(body: unknown): { title: string; body: string; paths: string[] } {
  const b = objectBody(body, "body");
  if (typeof b.title !== "string" || b.title.trim() === "")
    throw new HttpError(400, "title is required", { field: "title" });
  if (b.body !== undefined && typeof b.body !== "string")
    throw new HttpError(400, "body must be text", { field: "body" });
  if (!Array.isArray(b.paths) || b.paths.length === 0 || b.paths.some((p) => typeof p !== "string"))
    throw new HttpError(400, "choose at least one file", { field: "paths" });
  return { title: b.title.trim(), body: b.body ?? "", paths: b.paths as string[] };
}

export const gitRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/git", async () => {
    const git = ctx.git;
    if (!git || !(await git.hasRemote())) return { git: null };
    const status = await git.status();
    const changes = await Promise.all(
      status.changes.map(async (c) => ({
        path: c.path,
        status: c.status,
        ...summary(await recordChanges(git, ctx.root, ctx.y.tables, c.path)),
      })),
    );
    changes.sort((a, b) => a.path.localeCompare(b.path));
    return {
      git: { branch: status.branch, defaultBranch: await git.defaultBranch(), upstream: status.upstream, changes },
    };
  });

  // the field values behind one changed file's records, fetched when the UI shows them
  router.add("GET", "/api/git/diff", async ({ query }) => {
    const git = ctx.git;
    if (!git) throw new HttpError(404, "the data folder is not in a git repository");
    const path = query.get("path") ?? "";
    const rel = relative(ctx.root, resolve(ctx.root, path));
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
      throw new HttpError(400, `${path} is outside the data folder`);
    const found = await recordChanges(git, ctx.root, ctx.y.tables, path);
    if (!found?.records) throw new HttpError(404, `${path} holds no records to compare`);
    return {
      records: found.records.map((r) => {
        const keyField = ctx.y.tables.find((t) => t.name === found.table)?.key ?? "";
        const before = r.before ? withoutKey(r.before, keyField) : {};
        const after = r.after ? withoutKey(r.after, keyField) : {};
        const fields = [...new Set([...Object.keys(after), ...Object.keys(before)])]
          .filter((f) => r.kind !== "modified" || r.fields.includes(f))
          .map((field) => ({
            field,
            from: wireValue(own(before, field) ?? null),
            to: wireValue(own(after, field) ?? null),
          }));
        return { key: r.key, kind: r.kind, fields };
      }),
    };
  });

  router.add("POST", "/api/git/review", async ({ body }) => {
    const git = ctx.git;
    if (!git || !(await git.hasRemote()))
      throw new HttpError(404, "the data folder is not in a git repository with an origin");
    const req = reviewBody(body);
    const target = objectBody(body, "body").target;
    if (target !== undefined && target !== null && typeof target !== "string")
      throw new HttpError(400, "target must be a branch name or null", { field: "target" });
    return ctx.proposals.exclusive(async () => {
      // UI edits reach the files before git reads them
      assertSynced(await ctx.y.sync(), "could not write the latest edits to files for", "; nothing was sent");
      try {
        return await git.review(
          { ...req, target: target ?? null },
          {
            afterTreeChange: async () =>
              assertSynced(await ctx.y.sync(), "the database could not follow the files for"),
          },
        );
      } catch (e) {
        if (e instanceof ReviewRefused) throw new HttpError(e.status, e.message);
        throw e;
      }
    });
  });

  // puts records back to their committed values through the same writes as the forms, so the sync writes the files
  router.add("POST", "/api/git/revert", async ({ body }) => {
    const git = ctx.git;
    if (!git) throw new HttpError(404, "the data folder is not in a git repository");
    ctx.proposals.assertIdle();
    const items = objectBody(body, "body").records;
    if (!Array.isArray(items) || items.length === 0)
      throw new HttpError(400, "choose at least one record", { field: "records" });
    const plan = await Promise.all(
      items.map(async (raw) => {
        const item = objectBody(raw, "record");
        const spec = tableSpec(ctx, String(item.table));
        const key = String(item.key);
        const head = await headRecord(git, ctx.root, spec, key);
        const now = readRecord(ctx.store, spec, key);
        const before = now ? withoutKey(now, spec.key) : null;
        const after = head ? (wireValue(head) as Rec) : null;
        if (before === null && after === null) throw new HttpError(400, `${spec.name}/${key} has no changes`);
        if (before !== null && after !== null && canonical(before) === canonical(after))
          throw new HttpError(400, `${spec.name}/${key} has no changes`);
        // a record git has never seen has nothing to go back to; removing it must be asked for by name
        if (after === null && item.delete !== true)
          throw new HttpError(400, `${spec.name}/${key} is not committed; send delete: true to remove it`);
        // fields the commit does not have are cleared
        const values =
          after && before ? { ...Object.fromEntries(Object.keys(before).map((f) => [f, null])), ...after } : after;
        return { spec, key, before, after: values };
      }),
    );
    ctx.proposals.assertIdle();
    writeTx(ctx.store, () => {
      for (const p of plan) {
        if (p.after === null) deleteRecord(ctx.store, p.spec, p.key);
        else if (p.before === null) insertRecord(ctx.store, p.spec, p.key, p.after);
        else updateRecord(ctx.store, p.spec, p.key, p.after);
      }
    });
    return { reverted: plan.map((p) => ({ table: p.spec.name, key: p.key, before: p.before, after: p.after })) };
  });
};

function withoutKey(record: Rec, key: string): Rec {
  return Object.fromEntries(Object.entries(record).filter(([f]) => f !== key && own(record, f) !== undefined));
}

function summary(found: { table: string; records: RecordChange[] | null } | null) {
  if (!found) return { table: null, records: null };
  return {
    table: found.table,
    records: found.records?.map(({ key, kind, fields }) => ({ key, kind, fields })) ?? null,
  };
}
