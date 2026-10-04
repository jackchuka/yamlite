import { constants, DatabaseSync } from "node:sqlite";
import { canRead, notInAccess, type PageRules, trustedViews } from "../pages/access.ts";
import { BusyError, type ExecResult } from "../store.ts";
import type { DbRow } from "../types.ts";
import { HttpError } from "./http.ts";
import { definesName, mentionsName } from "./sqltext.ts";

const ALWAYS = new Set([constants.SQLITE_SELECT, constants.SQLITE_FUNCTION, constants.SQLITE_RECURSIVE]);
const TABLE_FUNCTIONS = new Set(["json_each", "json_tree"]);

// a page's queries get their own read-only connection, and an authorizer that sees only the page's access
export class PageSql {
  private db: DatabaseSync | undefined;

  constructor(private readonly path: string) {}

  run(page: PageRules, views: ReadonlyArray<{ name: string; parent: string }>, sql: string, limit: number): ExecResult {
    const trusted = trustedViews(page, views);
    // SQLite reports a read inside a CTE under the CTE's name, as it does for a view
    const shadowed = definesName(sql, trusted);
    if (shadowed !== null) throw new HttpError(400, `a WITH clause may not reuse the name of the view ${shadowed}`);
    // reads inside a trusted ancestor view arrive under its name, so naming one directly would bypass the access check
    const ancestors = [...trusted].filter((name) => page.access[name] === undefined);
    const named = mentionsName(sql, ancestors);
    if (named !== null) throw new HttpError(403, notInAccess(named));
    const db = this.connection();
    // a real table named like a table-valued function is reported the same way, so only names that are not objects get the allowance
    const shadows = new Set(
      (
        db
          .prepare("SELECT lower(name) AS n FROM sqlite_schema WHERE lower(name) IN ('json_each', 'json_tree')")
          .all() as Array<{ n: string }>
      ).map((r) => r.n),
    );
    let denied: string | undefined;
    db.setAuthorizer((action, table, _column, _schema, inner) => {
      if (ALWAYS.has(action)) return constants.SQLITE_OK;
      if (action === constants.SQLITE_READ && table !== null) {
        const fn = table.toLowerCase();
        if ((TABLE_FUNCTIONS.has(fn) && !shadows.has(fn)) || canRead(page, table)) return constants.SQLITE_OK;
        if (inner !== null && trusted.has(inner)) return constants.SQLITE_OK;
        denied ??= notInAccess(table);
      } else {
        denied ??= "a page can only read";
      }
      return constants.SQLITE_DENY;
    });
    try {
      const stmt = db.prepare(sql);
      stmt.setReadBigInts(true);
      const columns = stmt.columns().map((c) => c.name);
      if (columns.length === 0) throw new HttpError(403, "a page can only read");
      const rows: DbRow[] = [];
      let truncated = false;
      for (const row of stmt.iterate()) {
        if (rows.length === limit) {
          truncated = true;
          break;
        }
        rows.push({ ...row } as DbRow);
      }
      return { columns, rows, changes: 0, truncated };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (denied !== undefined) throw new HttpError(403, denied);
      const message = e instanceof Error ? e.message : String(e);
      if (/database is locked|SQLITE_BUSY/i.test(message)) throw new BusyError("database is locked");
      throw new HttpError(400, message);
    } finally {
      db.setAuthorizer(null);
    }
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  private connection(): DatabaseSync {
    if (!this.db) {
      this.db = new DatabaseSync(this.path, { readOnly: true });
      this.db.exec("PRAGMA busy_timeout = 5000");
    }
    return this.db;
  }
}
