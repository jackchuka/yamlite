import { rmSync } from "node:fs";
import { encode, rowToRecord } from "../../codec.ts";
import { saveConflict } from "../../conflicts.ts";
import { canonical } from "../../hash.ts";
import type { DbRow } from "../../types.ts";
import { dismissConflict, listConflicts, readConflict } from "../conflicts.ts";
import { tableSpec } from "../context.ts";
import { HttpError } from "../http.ts";
import { fromWire, toWire, wireValue } from "../wire.ts";
import { ensureColumns, writeTx } from "../write.ts";
import type { Routes } from "./index.ts";

export const conflictRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/conflicts", () => ({ conflicts: listConflicts(ctx.stateDir) }));

  router.add("GET", "/api/conflicts/:id", ({ params }) => {
    const backup = readConflict(ctx.stateDir, params.id as string);
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
    const id = params.id as string;
    const backup = readConflict(ctx.stateDir, id);
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
        const current = row ? rowToRecord(row, before, spec.mode === "dir" ? spec.key : undefined) : null;
        // the restored side wins now, so the saved version belongs to the side that won the original conflict
        swapPath = saveConflict(ctx.stateDir, spec.name, key, current, entry.winner === "db" ? "file" : "db");
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
    dismissConflict(ctx.stateDir, id);
    return { ok: true };
  });

  router.add("POST", "/api/conflicts/:id/dismiss", ({ params }) => {
    dismissConflict(ctx.stateDir, params.id as string);
    return { ok: true };
  });
};
