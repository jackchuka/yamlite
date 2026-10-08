// node:sqlite's DatabaseSync, as much of it as yamlite uses, on sqlite-wasm; the browser build aliases node:sqlite here.
// In a browser worker the files live in OPFS (the SAH pool VFS); registerVfs picks another one.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

// oxlint-disable-next-line typescript/no-explicit-any
export const sqlite3: any = await sqlite3InitModule();
const inBrowser = typeof (globalThis as { FileSystemHandle?: unknown }).FileSystemHandle !== "undefined";
// oxlint-disable-next-line typescript/no-explicit-any
export const opfs: any = inBrowser ? await sqlite3.installOpfsSAHPoolVfs({ name: "yamlite" }) : null;
let VFS: string | undefined = opfs?.vfsName;
export function registerVfs(name: string): void {
  VFS = name;
}
const { capi, oo1 } = sqlite3;

type Value = null | number | bigint | string | Uint8Array;
type Row = Record<string, Value>;

export const constants: Record<string, number> = Object.fromEntries(
  Object.entries(capi).filter(([k, v]) => k.startsWith("SQLITE_") && typeof v === "number"),
) as Record<string, number>;

class SqliteError extends Error {
  readonly code = "ERR_SQLITE_ERROR";
  constructor(
    message: string,
    readonly errcode: number,
    readonly errstr: string,
  ) {
    super(message);
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
function sqliteError(db: any, e: unknown): unknown {
  if (e instanceof SqliteError || !(e instanceof Error) || !("resultCode" in e)) return e;
  const ptr = db.pointer;
  const code = ptr ? capi.sqlite3_extended_errcode(ptr) : Number(e.resultCode);
  const message = ptr ? capi.sqlite3_errmsg(ptr) : e.message;
  return new SqliteError(message, code, capi.sqlite3_errstr(code));
}

const isNamed = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !(v instanceof Uint8Array) && !ArrayBuffer.isView(v);

const finalizer = new FinalizationRegistry<() => void>((fn) => fn());

export class StatementSync {
  private bigInts = false;
  private arrays = false;

  constructor(
    // oxlint-disable-next-line typescript/no-explicit-any
    private readonly db: any,
    // oxlint-disable-next-line typescript/no-explicit-any
    private readonly stmt: any,
  ) {
    finalizer.register(this, () => {
      try {
        if (stmt.pointer) stmt.finalize();
      } catch {}
    });
  }

  setReadBigInts(on: boolean): void {
    this.bigInts = on;
  }

  setReturnArrays(on: boolean): void {
    this.arrays = on;
  }

  columns() {
    const p = this.stmt.pointer;
    const n = capi.sqlite3_column_count(p);
    return Array.from({ length: n }, (_, i) =>
      Object.assign(Object.create(null), {
        column: null,
        database: null,
        name: capi.sqlite3_column_name(p, i) as string,
        table: null,
        type: (capi.sqlite3_column_decltype(p, i) as string | null) ?? null,
      }),
    ) as Array<{ name: string; type: string | null }>;
  }

  private bind(params: unknown[]): void {
    const s = this.stmt;
    const p = s.pointer;
    s.reset();
    s.clearBindings();
    const count = capi.sqlite3_bind_parameter_count(p);
    let named: Record<string, unknown> | undefined;
    let rest = params;
    if (isNamed(params[0])) {
      named = params[0];
      rest = params.slice(1);
    }
    let next = 0;
    for (let i = 1; i <= count; i++) {
      const name = capi.sqlite3_bind_parameter_name(p, i) as string | null;
      let v: unknown;
      if (name && named) v = name in named ? named[name] : named[name.slice(1)];
      else if (!name || /^\?\d*$/.test(name)) v = rest[name && name.length > 1 ? Number(name.slice(1)) - 1 : next++];
      else continue;
      if (v === undefined) continue;
      if (v === null) capi.sqlite3_bind_null(p, i);
      else if (typeof v === "number") capi.sqlite3_bind_double(p, i, v);
      else if (typeof v === "bigint") capi.sqlite3_bind_int64(p, i, v);
      else if (typeof v === "string" || v instanceof Uint8Array) s.bind(i, v);
      else throw new TypeError(`Provided value cannot be bound to SQLite parameter ${i}.`);
    }
  }

  private row(): Row | Value[] {
    const p = this.stmt.pointer;
    const n = capi.sqlite3_column_count(p);
    const values: Value[] = [];
    for (let i = 0; i < n; i++) {
      switch (capi.sqlite3_column_type(p, i)) {
        case capi.SQLITE_INTEGER: {
          const v = BigInt(capi.sqlite3_column_int64(p, i));
          if (this.bigInts) values.push(v);
          else if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
            const e = new RangeError(`Value is too large to be represented as a JavaScript number: ${v}`);
            throw Object.assign(e, { code: "ERR_OUT_OF_RANGE" });
          } else values.push(Number(v));
          break;
        }
        case capi.SQLITE_FLOAT:
          values.push(capi.sqlite3_column_double(p, i));
          break;
        case capi.SQLITE_TEXT:
          values.push(capi.sqlite3_column_text(p, i));
          break;
        case capi.SQLITE_BLOB:
          values.push(this.stmt.get(i, capi.SQLITE_BLOB));
          break;
        default:
          values.push(null);
      }
    }
    if (this.arrays) return values;
    const row: Row = Object.create(null);
    for (let i = 0; i < n; i++) row[capi.sqlite3_column_name(p, i)] = values[i] as Value;
    return row;
  }

  private step(): boolean {
    try {
      return this.stmt.step();
    } catch (e) {
      const err = sqliteError(this.db, e);
      // reset repeats the step's error code; err already carries it
      try {
        this.stmt.reset();
      } catch {}
      throw err;
    }
  }

  all(...params: unknown[]) {
    this.bind(params);
    const rows = [];
    while (this.step()) rows.push(this.row());
    this.stmt.reset();
    return rows;
  }

  get(...params: unknown[]) {
    this.bind(params);
    const row = this.step() ? this.row() : undefined;
    this.stmt.reset();
    return row;
  }

  *iterate(...params: unknown[]) {
    this.bind(params);
    try {
      while (this.step()) yield this.row();
    } finally {
      this.stmt.reset();
    }
  }

  run(...params: unknown[]) {
    this.bind(params);
    while (this.step());
    this.stmt.reset();
    const changes = capi.sqlite3_changes(this.db.pointer);
    const last = BigInt(capi.sqlite3_last_insert_rowid(this.db.pointer));
    return this.bigInts
      ? { changes: BigInt(changes), lastInsertRowid: last }
      : { changes: Number(changes), lastInsertRowid: Number(last) };
  }
}

export class DatabaseSync {
  // oxlint-disable-next-line typescript/no-explicit-any
  private readonly db: any;

  constructor(path: string, opts: { readOnly?: boolean } = {}) {
    try {
      this.db = new oo1.DB({
        filename: path,
        flags: opts.readOnly ? "r" : "c",
        ...(VFS && path !== ":memory:" ? { vfs: VFS } : {}),
      });
    } catch (e) {
      throw new SqliteError(
        e instanceof Error ? e.message : String(e),
        capi.SQLITE_CANTOPEN,
        "unable to open database file",
      );
    }
    capi.sqlite3_extended_result_codes(this.db.pointer, 1);
  }

  get isOpen(): boolean {
    return !!this.db.pointer;
  }

  get isTransaction(): boolean {
    return capi.sqlite3_get_autocommit(this.db.pointer) === 0;
  }

  exec(sql: string): void {
    try {
      this.db.exec(sql);
    } catch (e) {
      throw sqliteError(this.db, e);
    }
  }

  prepare(sql: string): StatementSync {
    try {
      return new StatementSync(this.db, this.db.prepare(sql));
    } catch (e) {
      throw sqliteError(this.db, e);
    }
  }

  setAuthorizer(fn: ((action: number, ...args: Array<string | null>) => number) | null): void {
    const cb = fn
      ? (_p: number, action: number, ...args: Array<string | 0>) => fn(action, ...args.map((a) => (a === 0 ? null : a)))
      : 0;
    capi.sqlite3_set_authorizer(this.db.pointer, cb, 0);
  }

  close(): void {
    if (!this.db.pointer) throw Object.assign(new Error("database is not open"), { code: "ERR_INVALID_STATE" });
    this.db.close();
  }
}
