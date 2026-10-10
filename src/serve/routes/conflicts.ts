import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { crossEqual, encode, rowToRecord } from "../../codec.ts";
import { type ConflictSource, saveConflict } from "../../conflicts.ts";
import { writeAtomic } from "../../fsutil.ts";
import { canonical } from "../../hash.ts";
import type { ColumnType, DbRow, Rec, TableSpec } from "../../types.ts";
import { dismissConflict, listConflicts, type ReadSource, readConflict } from "../conflicts.ts";
import { type ApiContext, tableSpec } from "../context.ts";
import { HttpError } from "../http.ts";
import { fromWire, toWire, wireValue } from "../wire.ts";
import { ensureColumns, writeTx } from "../write.ts";
import { extractor } from "./history.ts";
import type { Routes } from "./index.ts";
import { recordFile, recordFiles } from "./rows.ts";

const sourceReader =
  (ctx: ApiContext): ReadSource =>
  (table, key, text) => {
    const spec = ctx.y.tables.find((t) => t.name === table);
    const found = spec ? extractor(spec, key)(text) : null;
    if (!spec || found === null || found === "unreadable") return null;
    const { [spec.key]: _, ...record } = found;
    return record;
  };

// the record's file as it is, so the swap backup can bring back its comments and styles;
// none when the file does not hold the database's values yet
function currentSource(
  spec: TableSpec,
  key: string,
  current: Rec,
  types: Map<string, ColumnType>,
): ConflictSource | undefined {
  if (spec.mode !== "files") return undefined;
  const file = recordFile(spec, key);
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8");
  const found = extractor(spec, key)(text);
  if (found === null || found === "unreadable") return undefined;
  const { [spec.key]: _, ...record } = found;
  if (!crossEqual(record, current, types)) return undefined;
  return { file: relative(spec.path, file).split(sep).join("/"), text };
}

export const conflictRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/conflicts", () => ({ conflicts: listConflicts(ctx.stateDir) }));

  router.add("GET", "/api/conflicts/:id", ({ params }) => {
    const backup = readConflict(ctx.stateDir, params.id as string, sourceReader(ctx));
    const spec = ctx.y.tables.find((t) => t.name === backup.entry.table);
    const key = backup.entry.key;
    const row =
      spec && key !== null && ctx.store.tableExists(spec.name)
        ? ctx.store.readRow(spec.name, spec.key, key)
        : undefined;
    return {
      entry: backup.entry,
      deleted: backup.deleted,
      saved: backup.record === null ? null : wireValue(backup.record),
      current: row && spec ? toWire(row, ctx.store.columns(spec.name)) : null,
      text: backup.text,
    };
  });

  // the backup becomes the database row; the watcher then writes it to the file like any other edit.
  // The row it replaces is backed up first, so a restore is a swap that can itself be restored.
  router.add("POST", "/api/conflicts/:id/restore", ({ params, body }) => {
    ctx.proposals.assertIdle();
    const id = params.id as string;
    const backup = readConflict(ctx.stateDir, id, sourceReader(ctx));
    const { entry } = backup;
    if (!entry.restorable || entry.key === null) {
      throw new HttpError(400, "this backup has no yamlite header, so its key is unknown; restore it by hand");
    }
    const spec = tableSpec(ctx, entry.table);
    const key = entry.key;
    const { store } = ctx;
    const expected = body && typeof body === "object" ? (body as { expected?: unknown }).expected : undefined;
    let swapPath: string | undefined;
    try {
      writeTx(store, () => {
        const exists = store.tableExists(spec.name);
        const before = exists ? store.columns(spec.name) : new Map();
        const keyValue = encode(fromWire(key, before.get(spec.key)));
        const row = exists ? store.readRow(spec.name, spec.key, keyValue) : undefined;
        if (expected !== undefined) {
          const current = row ? toWire(row, before) : null;
          if (canonical(current) !== canonical(expected)) {
            throw new HttpError(409, "the record changed since it was loaded", { current });
          }
        }
        // same shape as the engine's backup of a database side
        const current = row ? rowToRecord(row, before, spec.mode === "files" ? spec.key : undefined) : null;
        // the restored side wins now, so the saved version belongs to the side that won the original conflict
        swapPath = saveConflict(ctx.stateDir, spec.name, key, current, entry.winner === "db" ? "file" : "db", {
          source: current ? currentSource(spec, key, current, before) : undefined,
        });
        if (backup.record === null) {
          if (exists) store.delete(spec.name, spec.key, keyValue);
          return;
        }
        const { [spec.key]: _key, ...record } = backup.record;
        const types = ensureColumns(store, spec, record);
        // every column is written, so fields the backup lacks are cleared rather than kept from the winner
        const next: DbRow = {};
        for (const column of types.keys())
          next[column] = column === spec.key ? keyValue : encode(record[column] ?? null);
        store.upsert(spec.name, spec.key, next, Object.keys(next));
      });
    } catch (e) {
      // the backup file is not part of the transaction; without this a failed or retried restore leaves duplicates
      if (swapPath) rmSync(swapPath, { force: true });
      throw e;
    }
    restoreSource(spec, key, backup.source);
    dismissConflict(ctx.stateDir, id);
    return { ok: true };
  });

  router.add("POST", "/api/conflicts/:id/dismiss", ({ params }) => {
    ctx.proposals.assertIdle();
    dismissConflict(ctx.stateDir, params.id as string);
    return { ok: true };
  });
};

// a record whose file is gone gets its saved file back as it was; the sync would write it fresh, losing its comments
// and styles. Only one of the file names the record may have is written, so a backup never writes elsewhere.
function restoreSource(spec: TableSpec, key: string, source: ConflictSource | null): void {
  if (!source || spec.mode !== "files" || existsSync(recordFile(spec, key))) return;
  const file = join(spec.path, source.file);
  if (!recordFiles(spec, key).includes(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeAtomic(file, source.text);
}
