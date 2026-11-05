import { NoRepository, ReviewRefused } from "../../git/driver.ts";
import type { ReviewRequest } from "../../git/review.ts";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { type DraftFile, draftReview } from "../../agent/reviewdraft.ts";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { writeAtomic } from "../../fsutil.ts";
import { canonical } from "../../hash.ts";
import { own, type Rec } from "../../types.ts";
import { tableSpec } from "../context.ts";
import { headRecord, ownerOf, type RecordChange, recordChanges } from "../gitrecords.ts";
import { deleteRecord, insertRecord, readRecord, updateRecord } from "../records.ts";
import { wireValue } from "../wire.ts";
import { HttpError } from "../http.ts";
import { assertSynced, objectBody, writeTx } from "../write.ts";
import type { Routes } from "./index.ts";
import { modelError } from "./pageai.ts";

function reviewBody(body: unknown): ReviewRequest {
  const b = objectBody(body, "body");
  if (typeof b.title !== "string" || b.title.trim() === "")
    throw new HttpError(400, "title is required", { field: "title" });
  if (b.body !== undefined && typeof b.body !== "string")
    throw new HttpError(400, "body must be text", { field: "body" });
  if (!Array.isArray(b.paths) || b.paths.length === 0 || b.paths.some((p) => typeof p !== "string"))
    throw new HttpError(400, "choose at least one file", { field: "paths" });
  if (b.branch !== undefined && typeof b.branch !== "string")
    throw new HttpError(400, "branch must be text", { field: "branch" });
  const branch = b.branch?.trim();
  return { title: b.title.trim(), body: b.body ?? "", paths: b.paths as string[], ...(branch ? { branch } : {}) };
}

export const gitRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/git", async () => {
    const git = ctx.git;
    const review = git?.review;
    if (!git || !review || !(await review.available())) return { git: null };
    const status = await git.status();
    const changes = await Promise.all(
      status.changes.map(async (c) => ({
        path: c.path,
        status: c.status,
        ...summary(await recordChanges(git, ctx.root, ctx.y.tables, c.path)),
      })),
    );
    changes.sort((a, b) => a.path.localeCompare(b.path));
    const defaultBranch = await review.defaultBranch();
    return {
      git: {
        branch: status.branch,
        defaultBranch,
        upstream: status.upstream,
        namesBranch: review.namesBranch === true,
        // the files can be put back as the default branch has them; the list comes from /api/git/default
        restoresDefault:
          review.defaultBranchFiles !== undefined &&
          status.branch !== null &&
          defaultBranch !== null &&
          status.branch !== defaultBranch,
        changes,
      },
    };
  });

  // the files the review changes from the default branch; unsent: the file also has edits not sent yet
  router.add("GET", "/api/git/default", async () => {
    const from = ctx.git?.review?.defaultBranchFiles;
    if (!from) throw new HttpError(404, "this host cannot read the default branch");
    const [changes, status] = await Promise.all([from.changes().catch(notFound), ctx.git!.status()]);
    const unsent = new Set(status.changes.map((c) => c.path));
    return {
      files: changes
        .map((c) => ({
          path: c.path,
          status: c.status,
          table: ownerOf(ctx.y.tables, join(ctx.root, c.path))?.spec.name ?? null,
          unsent: unsent.has(c.path),
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
  });

  // writes the chosen files as the default branch has them, or removes those it has not; they become unsent edits
  router.add("POST", "/api/git/restore-default", async ({ body }) => {
    const from = ctx.git?.review?.defaultBranchFiles;
    if (!from) throw new HttpError(404, "this host cannot read the default branch");
    const paths = objectBody(body, "body").files;
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== "string"))
      throw new HttpError(400, "choose at least one file", { field: "files" });
    return ctx.proposals.exclusive(async () => {
      const changed = new Set((await from.changes().catch(notFound)).map((c) => c.path));
      const files = await Promise.all(
        (paths as string[]).map(async (path) => {
          const file = resolve(ctx.root, path);
          const rel = relative(ctx.root, file);
          if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
            throw new HttpError(400, `${path} is outside the data folder`);
          if (!changed.has(path)) throw new HttpError(400, `${path} is the same as on the default branch`);
          const content = await from.file(path).catch(notFound);
          if (content === null && existsSync(file) && lstatSync(file).isDirectory())
            throw new HttpError(409, `${path} is a folder; remove it with git`);
          return { path, file, content };
        }),
      );
      // UI edits reach the files first, so a later sync does not write them over the restored files
      assertSynced(await ctx.y.sync(), "could not write the latest edits to files for", "; nothing was restored");
      for (const f of files) {
        if (f.content === null) rmSync(f.file, { force: true });
        else {
          mkdirSync(dirname(f.file), { recursive: true });
          writeAtomic(f.file, f.content);
        }
      }
      if (files.some((f) => f.file === resolve(ctx.configFile))) ctx.reloadConfig();
      // these files were written on purpose, so a table left with fewer records is not a wipe
      assertSynced(await ctx.y.sync({ force: true }), "the database could not follow the files for");
      return { files: files.map((f) => f.path) };
    });
  });

  // the field values behind one changed file's records, fetched when the UI shows them
  router.add("GET", "/api/git/diff", async ({ query }) => {
    const git = ctx.git;
    if (!git) throw new HttpError(404, "the data folder is not in a git repository");
    const path = query.get("path") ?? "";
    const rel = relative(ctx.root, resolve(ctx.root, path));
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
      throw new HttpError(400, `${path} is outside the data folder`);
    const found = await recordChanges(git, ctx.root, ctx.y.tables, path).catch(notFound);
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
    const review = ctx.git?.review;
    if (!review || !(await review.available()))
      throw new HttpError(404, "the data folder is not in a git repository with an origin");
    const req = reviewBody(body);
    if (req.branch !== undefined && !review.namesBranch)
      throw new HttpError(400, "this host names the branch for a review itself", { field: "branch" });
    const target = objectBody(body, "body").target;
    if (target !== undefined && target !== null && typeof target !== "string")
      throw new HttpError(400, "target must be a branch name or null", { field: "target" });
    return ctx.proposals.exclusive(async () => {
      // UI edits reach the files before git reads them
      assertSynced(await ctx.y.sync(), "could not write the latest edits to files for", "; nothing was sent");
      try {
        return await review.review(
          { ...req, target: target ?? null },
          {
            afterTreeChange: async () =>
              assertSynced(await ctx.y.sync(), "the database could not follow the files for"),
          },
        );
      } catch (e) {
        if (e instanceof ReviewRefused) throw new HttpError(e.status, e.message);
        if (e instanceof NoRepository)
          throw new HttpError(404, "the data folder is not in a git repository with an origin");
        throw e;
      }
    });
  });

  // asked when the review dialog opens rather than with /api/git, since gh is slow and /api/git is fetched often
  router.add("GET", "/api/git/pr", async () => {
    const git = ctx.git;
    if (!git) throw new HttpError(404, "the data folder is not in a git repository");
    return { url: (await git.review?.openPr?.().catch(notFound)) ?? null };
  });

  router.add("POST", "/api/git/review/draft", async ({ body, signal }) => {
    const git = ctx.git;
    if (!git) throw new HttpError(404, "the data folder is not in a git repository");
    if (!ctx.agent) throw new HttpError(404, "no agent is available");
    const b = objectBody(body, "body");
    if (!Array.isArray(b.paths) || b.paths.length === 0 || b.paths.some((p) => typeof p !== "string"))
      throw new HttpError(400, "choose at least one file", { field: "paths" });
    if (b.mode !== "pr" && b.mode !== "commit") throw new HttpError(400, "mode must be pr or commit");
    const locale = typeof b.locale === "string" ? b.locale : "en";
    const { provider, languageModel } = ctx.agent.viewerModel({
      provider: b.provider,
      model: b.model,
      apiKey: b.apiKey,
    });
    const changed = new Map((await git.status().catch(notFound)).changes.map((c) => [c.path, c.status]));
    const files: DraftFile[] = await Promise.all(
      (b.paths as string[]).map(async (path) => {
        const status = changed.get(path);
        if (status === undefined) throw new HttpError(400, `${path} has no changes`);
        const found = await recordChanges(git, ctx.root, ctx.y.tables, path);
        if (found?.records) return { path, status, table: found.table, records: found.records };
        return {
          path,
          status,
          table: found?.table ?? null,
          records: null,
          before: shownText(await git.baseContent(path)),
          after: shownFile(join(ctx.root, path)),
        };
      }),
    );
    const template = b.mode === "pr" ? ((await git.review?.pullRequestTemplate?.()) ?? null) : null;
    const release = ctx.agent.pageSlot();
    try {
      return await draftReview(languageModel, { files, mode: b.mode, locale, template, ai: ctx.y.ai }, signal);
    } catch (e) {
      throw modelError(e, provider);
    } finally {
      release();
    }
  });

  // puts records back to their committed values through the same writes as the forms, so the sync writes the files;
  // other changed files are written back as committed, or removed when git has never seen them
  router.add("POST", "/api/git/revert", async ({ body }) => {
    const git = ctx.git;
    if (!git) throw new HttpError(404, "the data folder is not in a git repository");
    ctx.proposals.assertIdle();
    const b = objectBody(body, "body");
    const items = b.records ?? [];
    const paths = b.files ?? [];
    if (!Array.isArray(items)) throw new HttpError(400, "records must be a list", { field: "records" });
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string"))
      throw new HttpError(400, "files must be a list of paths", { field: "files" });
    if (items.length === 0 && paths.length === 0)
      throw new HttpError(400, "choose at least one record or file", { field: "records" });
    const changed = new Map(paths.length > 0 ? (await git.status()).changes.map((c) => [c.path, c.status]) : []);
    const files = await Promise.all(
      (paths as string[]).map(async (path) => {
        const file = resolve(ctx.root, path);
        const rel = relative(ctx.root, file);
        if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
          throw new HttpError(400, `${path} is outside the data folder`);
        const status = changed.get(path);
        if (status === undefined) throw new HttpError(400, `${path} has no changes`);
        const content = await git.baseFile(path).catch(notFound);
        // a changed file the commit has no file for was renamed or copied; removing it would lose it
        if (content === null && status !== "added")
          throw new HttpError(409, `${path} is not in the last commit under this name; put it back with git`);
        if (content === null && existsSync(file) && lstatSync(file).isDirectory())
          throw new HttpError(409, `${path} is a folder; remove it with git`);
        return { path, file, content };
      }),
    );
    const plan = await Promise.all(
      items.map(async (raw) => {
        const item = objectBody(raw, "record");
        const spec = tableSpec(ctx, String(item.table));
        const key = String(item.key);
        const head = await headRecord(git, ctx.root, spec, key).catch(notFound);
        const now = readRecord(ctx.store, spec, key);
        const before = now ? withoutKey(now, spec.key) : null;
        const after = head ? (wireValue(head.values) as Rec) : null;
        if (before === null && after === null) throw new HttpError(400, `${spec.name}/${key} has no changes`);
        if (before !== null && after !== null && canonical(before) === canonical(after))
          throw new HttpError(400, `${spec.name}/${key} has no changes`);
        // a record git has never seen has nothing to go back to; removing it must be asked for by name
        if (after === null && item.delete !== true)
          throw new HttpError(400, `${spec.name}/${key} is not committed; send delete: true to remove it`);
        // fields the commit does not have are cleared
        const values =
          after && before ? { ...Object.fromEntries(Object.keys(before).map((f) => [f, null])), ...after } : after;
        // a file of its own that is gone is written back as committed; the sync would write it fresh,
        // losing its comments and styles
        const restore = before === null && head && spec.mode === "files" && !existsSync(head.file) ? head : undefined;
        return { spec, key, before, after: values, restore };
      }),
    );
    ctx.proposals.assertIdle();
    // files first: a write that fails leaves the records as they were
    for (const f of files) {
      if (f.content === null) rmSync(f.file, { force: true });
      else {
        mkdirSync(dirname(f.file), { recursive: true });
        writeAtomic(f.file, f.content);
      }
    }
    if (files.some((f) => f.file === resolve(ctx.configFile))) ctx.reloadConfig();
    writeTx(ctx.store, () => {
      for (const p of plan) {
        if (p.after === null) deleteRecord(ctx.store, p.spec, p.key);
        else if (p.before === null) insertRecord(ctx.store, p.spec, p.key, p.after);
        else updateRecord(ctx.store, p.spec, p.key, p.after);
      }
    });
    for (const p of plan) {
      if (!p.restore || existsSync(p.restore.file)) continue;
      mkdirSync(dirname(p.restore.file), { recursive: true });
      writeAtomic(p.restore.file, p.restore.content);
    }
    return {
      reverted: plan.map((p) => ({ table: p.spec.name, key: p.key, before: p.before, after: p.after })),
      files: files.map((f) => f.path),
    };
  });
};

// what of a changed file's text goes to the model: never a symlink's target, which may be outside the data folder,
// nor a binary or a large file
const DRAFT_FILE_BYTES = 64 * 1024;
const OMITTED = "(not shown: a binary file or one larger than 64 KB)";

function shownText(text: string | null): string | null {
  if (text === null) return null;
  return text.length > DRAFT_FILE_BYTES || text.includes("\0") ? OMITTED : text;
}

function shownFile(file: string): string | null {
  if (!existsSync(file)) return null;
  const s = lstatSync(file);
  if (!s.isFile()) return s.isSymbolicLink() ? "(a symbolic link)" : null;
  return s.size > DRAFT_FILE_BYTES ? OMITTED : shownText(readFileSync(file, "utf8"));
}

// a local serve started outside a repository answers as if it had no git
function notFound(e: unknown): never {
  if (e instanceof NoRepository) throw new HttpError(404, e.message);
  throw e;
}

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
