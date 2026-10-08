import { defaultBranch, gitStatus, insideRoot, runGit } from "../../git/repo.ts";
import { openPrUrl, reviewSteps } from "../../git/review.ts";
import { runSteps, validateSteps } from "../../git/steps.ts";
import { canonical } from "../../hash.ts";
import { own, type Rec } from "../../types.ts";
import { type ApiContext, tableSpec } from "../context.ts";
import { headRecord, type RecordChange, recordChanges } from "../gitrecords.ts";
import { deleteRecord, insertRecord, readRecord, updateRecord } from "../records.ts";
import { wireValue } from "../wire.ts";
import { HttpError } from "../http.ts";
import { assertSynced, objectBody, writeTx } from "../write.ts";
import type { Routes } from "./index.ts";

type ChangeStatus = "added" | "modified" | "deleted";

// porcelain v2 XY codes, staged or not
function changeStatus(xy: string): ChangeStatus {
  if (xy === "??" || xy.includes("A")) return "added";
  if (xy.includes("D")) return "deleted";
  return "modified";
}

async function hasOrigin(ctx: ApiContext): Promise<boolean> {
  if (!ctx.git) return false;
  try {
    await runGit(ctx.git.repo.top, ["remote", "get-url", "origin"]);
    return true;
  } catch {
    return false;
  }
}

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
  let base: string | null = null;
  const baseBranch = async () => (base ??= ctx.git ? await defaultBranch(ctx.git.repo) : null);

  router.add("GET", "/api/git", async () => {
    if (!ctx.git || !(await hasOrigin(ctx))) return { git: null };
    const { repo } = ctx.git;
    const status = await gitStatus(repo);
    const changes = await Promise.all(
      status.changes.map(async (c) => ({
        path: c.path,
        status: changeStatus(c.status),
        ...summary(await recordChanges(repo, ctx.root, ctx.y.tables, c.path)),
      })),
    );
    changes.sort((a, b) => a.path.localeCompare(b.path));
    return { git: { branch: status.branch, defaultBranch: await baseBranch(), upstream: status.upstream, changes } };
  });

  // the field values behind one changed file's records, fetched when the UI shows them
  router.add("GET", "/api/git/diff", async ({ query }) => {
    const git = ctx.git;
    if (!git) throw new HttpError(404, "the data folder is not in a git repository");
    const path = query.get("path") ?? "";
    if (insideRoot(git.repo, path) === null) throw new HttpError(400, `${path} is outside the data folder`);
    const found = await recordChanges(git.repo, ctx.root, ctx.y.tables, path);
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
    if (!git || !(await hasOrigin(ctx)))
      throw new HttpError(404, "the data folder is not in a git repository with an origin");
    const req = reviewBody(body);
    return ctx.proposals.exclusive(async () => {
      // UI edits reach the files before git reads them
      assertSynced(await ctx.y.sync(), "could not write the latest edits to files for", "; nothing was sent");
      const { branch } = await gitStatus(git.repo);
      if (branch === null) throw new HttpError(409, "check out a branch first; HEAD is detached");
      const defaultBranch = await baseBranch();
      if (defaultBranch === null) throw new HttpError(409, "cannot tell the remote default branch of origin");
      const existing = branch === defaultBranch ? null : await openPrUrl(git.repo, await git.gh(), branch);
      const planned = reviewSteps(req, { branch, defaultBranch, now: new Date(), openPr: existing === null });
      let steps;
      try {
        ({ steps } = await validateSteps(git.repo, planned));
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
      const results = await runSteps(git.repo, steps, {
        gh: await git.gh(),
        expectBranch: branch,
        afterTreeChange: async () => assertSynced(await ctx.y.sync(), "the database could not follow the files for"),
      });
      const failed = results.find((r) => r.status === "failed");
      const pr = results.find((r) => r.url);
      const head = steps[0]?.kind === "create_branch" ? steps[0].name : branch;
      return {
        branch: head,
        steps: steps.map((s) => s.kind),
        results,
        url: pr?.url ?? existing,
        created: pr?.created ?? false,
        ...(failed ? { error: failed.message ?? "a git step failed" } : {}),
      };
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
        const head = await headRecord(git.repo, ctx.root, spec, key);
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
