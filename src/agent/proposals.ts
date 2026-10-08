import { randomBytes } from "node:crypto";
import { constants } from "node:sqlite";
import { canonical } from "../hash.ts";
import type { GitStep, StepResult } from "../git/steps.ts";
import { checkRequired } from "../required.ts";
import { checkBounds, checkFormats } from "../rulecheck.ts";
import { HttpError } from "../serve/http.ts";
import { deleteRecord, insertRecord, readRecord, updateRecord } from "../serve/records.ts";
import { toWire } from "../serve/wire.ts";
import { writeTx } from "../serve/write.ts";
import { BusyError, type Store } from "../store.ts";
import type { ColumnType, Rec, TableSpec } from "../types.ts";
import { checkValues } from "../values.ts";

export const MAX_PROPOSAL_ROWS = 500;

export type ProposalStatus = "pending" | "applied" | "discarded" | "stale" | "failed";
export type RowOp = "insert" | "update" | "delete";
const ROW_OPS = new Set<string>(["insert", "update", "delete"] satisfies RowOp[]);

export interface ProposalRow {
  table: string;
  key: string;
  op: RowOp;
  before: Rec | null;
  after: Rec | null;
  changed: string[];
}

export interface NewTable {
  name: string;
  mode: "files" | "list";
  key: string;
  columns: Record<string, ColumnType>;
  group?: string;
}

export interface Proposal {
  id: string;
  conversationId: string;
  title: string;
  status: ProposalStatus;
  createdAt: string;
  rows: ProposalRow[];
  // rule warnings (required, values, formats, bounds) the proposal would add
  warnings: string[];
  table?: NewTable;
  sql?: string;
  git?: { steps: GitStep[]; startBranch: string | null; results: StepResult[] };
  stale?: string[];
  error?: string;
}

export interface RecordChange {
  table: string;
  key: string;
  op: RowOp;
  values?: Rec;
}

export interface ProposalDeps {
  // the UI's connection: applying writes through it like a form save
  store: Store;
  // a second connection for dry runs, always rolled back
  dry: Store;
  tables: () => readonly TableSpec[];
  createTable: (t: NewTable) => void;
  runGit?: (
    steps: GitStep[],
    startBranch: string | null,
    onProgress: (r: StepResult[]) => void,
  ) => Promise<StepResult[]>;
}

class StaleError extends Error {}

const READS = new Set([
  constants.SQLITE_SELECT,
  constants.SQLITE_READ,
  constants.SQLITE_FUNCTION,
  constants.SQLITE_RECURSIVE,
]);
const WRITES = new Set([constants.SQLITE_INSERT, constants.SQLITE_UPDATE, constants.SQLITE_DELETE]);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const changedFields = (a: Rec, b: Rec): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (f) => canonical(a[f] ?? null) !== canonical(b[f] ?? null),
  );

function diff(table: string, before: Map<string, Rec>, after: Map<string, Rec>): ProposalRow[] {
  const rows: ProposalRow[] = [];
  for (const [key, a] of after) {
    const b = before.get(key);
    if (!b) rows.push({ table, key, op: "insert", before: null, after: a, changed: Object.keys(a) });
    else {
      const changed = changedFields(b, a);
      if (changed.length > 0) rows.push({ table, key, op: "update", before: b, after: a, changed });
    }
  }
  for (const [key, b] of before) {
    if (!after.has(key)) rows.push({ table, key, op: "delete", before: b, after: null, changed: [] });
  }
  return rows;
}

function snapshot(store: Store, spec: TableSpec): Map<string, Rec> {
  if (!store.tableExists(spec.name)) return new Map();
  const types = store.columns(spec.name);
  return new Map([...store.readAll(spec.name, spec.key).rows].map(([k, row]) => [k, toWire(row, types)]));
}

function ruleWarnings(store: Store, spec: TableSpec): string[] {
  if (!store.tableExists(spec.name)) return [];
  return [
    ...checkRequired(store, spec),
    ...checkValues(store, spec),
    ...checkFormats(store, spec),
    ...checkBounds(store, spec),
  ];
}

export class ProposalStore {
  private readonly proposals = new Map<string, Proposal>();
  private readonly feedback = new Map<string, string[]>();
  private runningId: string | null = null;

  constructor(
    private readonly deps: ProposalDeps,
    private readonly onChange: (p: Proposal) => void = () => {},
  ) {}

  fromChanges(conversationId: string, title: string, changes: RecordChange[]): Proposal {
    if (changes.length === 0) throw new HttpError(400, "changes is empty");
    if (changes.length > MAX_PROPOSAL_ROWS) throw this.tooMany();
    for (const c of changes) {
      if (!ROW_OPS.has(c.op)) throw new HttpError(400, `unknown op: ${String(c.op)}; use insert, update or delete`);
    }
    const { dry } = this.deps;
    const tables = [...new Set(changes.map((c) => c.table))];
    const { rows, warnings } = this.dryRun(tables, () => {
      for (const c of changes) {
        const spec = this.spec(c.table);
        if (c.op === "insert") insertRecord(dry, spec, c.key, c.values ?? {});
        else if (c.op === "update") updateRecord(dry, spec, c.key, c.values ?? {});
        else deleteRecord(dry, spec, c.key);
      }
    });
    return this.add({ conversationId, title, rows, warnings });
  }

  fromSql(conversationId: string, title: string, sql: string): Proposal {
    const { dry } = this.deps;
    const managed = new Set(this.deps.tables().map((t) => t.name));
    const touched = new Set<string>();
    const run = () => {
      let refused: string | undefined;
      dry.authorize((action, table) => {
        if (WRITES.has(action) && table !== null && managed.has(table)) {
          touched.add(table);
          return constants.SQLITE_OK;
        }
        if (READS.has(action)) return constants.SQLITE_OK;
        refused ??= WRITES.has(action)
          ? `only tables listed in yamlite.yaml can be changed, not ${table}`
          : "propose_sql runs INSERT, UPDATE and DELETE only";
        return constants.SQLITE_DENY;
      });
      try {
        dry.exec(sql);
      } catch (e) {
        throw new HttpError(400, refused ?? message(e));
      } finally {
        dry.authorize(null);
      }
    };
    // a first run learns which tables the SQL writes, so the second can snapshot them before it runs
    dry.begin();
    try {
      run();
    } finally {
      dry.rollback();
    }
    if (touched.size === 0) throw new HttpError(400, "the SQL changes no table; use query to read");
    const { rows, warnings } = this.dryRun([...touched], run);
    return this.add({ conversationId, title, rows, warnings, sql });
  }

  forTable(conversationId: string, title: string, table: NewTable): Proposal {
    if (this.deps.tables().some((t) => t.name === table.name)) {
      throw new HttpError(409, `a table named "${table.name}" already exists`);
    }
    return this.add({ conversationId, title, rows: [], warnings: [], table }, true);
  }

  forGit(conversationId: string, title: string, steps: GitStep[], startBranch: string | null): Proposal {
    const results: StepResult[] = steps.map(() => ({ status: "skipped" }));
    return this.add({ conversationId, title, rows: [], warnings: [], git: { steps, startBranch, results } }, true);
  }

  get running(): boolean {
    return this.runningId !== null;
  }

  assertIdle(): void {
    if (this.running) throw new HttpError(409, "git steps are running; try again when they finish");
  }

  get(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  pending(): Proposal[] {
    return [...this.proposals.values()].filter((p) => p.status === "pending");
  }

  async applyGit(id: string): Promise<Proposal> {
    this.assertIdle();
    const p = this.mustBePending(id);
    if (!p.git) throw new HttpError(400, `proposal ${id} has no git steps`);
    const git = p.git;
    if (!this.deps.runGit) return this.settle(p, "failed", { error: "git is not available" });
    this.runningId = id;
    try {
      git.results = await this.deps.runGit(git.steps, git.startBranch, (r) => {
        git.results = r;
        this.onChange(p);
      });
    } catch (e) {
      return this.settle(p, "failed", { error: message(e) });
    } finally {
      this.runningId = null;
    }
    const failed = git.results.findIndex((r) => r.status === "failed");
    if (failed < 0) return this.settle(p, "applied");
    const step = git.steps[failed] as GitStep;
    return this.settle(p, "failed", {
      error: `step ${failed + 1} (${step.kind}) failed${git.results[failed]?.message ? `: ${git.results[failed].message}` : ""}`,
    });
  }

  apply(id: string): Proposal {
    this.assertIdle();
    if (this.proposals.get(id)?.git) throw new HttpError(400, "git proposals run with applyGit");
    const p = this.mustBePending(id);
    if (p.table) {
      try {
        this.deps.createTable(p.table);
        return this.settle(p, "applied");
      } catch (e) {
        if (e instanceof BusyError) throw e;
        return this.settle(p, "failed", { error: message(e) });
      }
    }
    const { store } = this.deps;
    const stale: string[] = [];
    try {
      writeTx(store, () => {
        for (const r of p.rows) {
          if (canonical(readRecord(store, this.spec(r.table), r.key) ?? null) !== canonical(r.before)) {
            stale.push(`${r.table}/${r.key}`);
          }
        }
        if (stale.length > 0) throw new StaleError();
        for (const r of p.rows) {
          const spec = this.spec(r.table);
          if (r.op === "insert") {
            const { [spec.key]: _key, ...values } = r.after ?? {};
            insertRecord(store, spec, r.key, values);
          } else if (r.op === "update") {
            updateRecord(store, spec, r.key, Object.fromEntries(r.changed.map((f) => [f, r.after?.[f] ?? null])));
          } else deleteRecord(store, spec, r.key);
        }
      });
      return this.settle(p, "applied");
    } catch (e) {
      if (e instanceof StaleError) return this.settle(p, "stale", { stale });
      if (e instanceof BusyError) throw e;
      return this.settle(p, "failed", { error: message(e) });
    }
  }

  discard(id: string): Proposal {
    this.assertIdle();
    return this.settle(this.mustBePending(id), "discarded");
  }

  takeFeedback(conversationId: string): string[] {
    const notes = this.feedback.get(conversationId) ?? [];
    this.feedback.delete(conversationId);
    return notes;
  }

  private dryRun(tables: string[], fn: () => void): { rows: ProposalRow[]; warnings: string[] } {
    const { dry } = this.deps;
    const specs = tables.map((name) => this.spec(name));
    dry.begin();
    try {
      const before = specs.map((s) => snapshot(dry, s));
      const warnedBefore = new Set(specs.flatMap((s) => ruleWarnings(dry, s)));
      fn();
      const rows = specs.flatMap((s, i) => diff(s.name, before[i] as Map<string, Rec>, snapshot(dry, s)));
      const warnings = specs.flatMap((s) => ruleWarnings(dry, s)).filter((w) => !warnedBefore.has(w));
      return { rows, warnings };
    } finally {
      dry.rollback();
    }
  }

  private add(
    p: Pick<Proposal, "conversationId" | "title" | "rows" | "warnings" | "table" | "sql" | "git">,
    empty = false,
  ): Proposal {
    if (!empty && p.rows.length === 0) throw new HttpError(400, "the changes would not change anything");
    if (p.rows.length > MAX_PROPOSAL_ROWS) throw this.tooMany();
    const proposal: Proposal = {
      ...p,
      id: `p_${randomBytes(6).toString("hex")}`,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.proposals.set(proposal.id, proposal);
    this.onChange(proposal);
    return proposal;
  }

  private settle(p: Proposal, status: ProposalStatus, extra: Partial<Proposal> = {}): Proposal {
    Object.assign(p, { status, ...extra });
    const name = `proposal ${p.id} ("${p.title}")`;
    const steps = p.git
      ? ` Steps: ${p.git.steps
          .map((s, i) => {
            const r = p.git?.results[i];
            const what =
              s.kind === "create_branch"
                ? s.name
                : s.kind === "commit"
                  ? s.message
                  : s.kind === "open_pr"
                    ? s.title
                    : s.branch;
            const extra = r?.url
              ? ` ${r.created ? "PR" : "the user must open this link to create the PR:"} ${r.url}`
              : "";
            return `${s.kind} ${what}: ${r?.status ?? "skipped"}${extra}`;
          })
          .join("; ")}.`
      : "";
    const stopped = p.git?.results.findIndex((r) => r.status === "failed") ?? -1;
    const stoppedStep = p.git?.steps[stopped];
    const gitNote =
      status === "applied"
        ? `The user applied ${name}; all git steps ran.`
        : stoppedStep
          ? `${name} stopped at step ${stopped + 1} (${stoppedStep.kind})${p.git?.results[stopped]?.message ? `: ${p.git.results[stopped].message}` : ""}. Earlier steps were done and are not undone.`
          : `${name} failed to run: ${p.error}. Steps that already ran are not undone.`;
    const note =
      p.git && (status === "applied" || status === "failed")
        ? gitNote
        : status === "applied"
          ? `The user applied ${name}; the changes are saved.`
          : status === "discarded"
            ? `The user discarded ${name}; nothing was saved.`
            : status === "stale"
              ? `${name} was not applied: these records changed since it was made: ${p.stale?.join(", ")}. Nothing was saved.`
              : `${name} failed to apply: ${p.error}. Nothing was saved.`;
    this.feedback.set(p.conversationId, [
      ...(this.feedback.get(p.conversationId) ?? []),
      note[0]?.toUpperCase() + note.slice(1) + steps,
    ]);
    this.onChange(p);
    return p;
  }

  private mustBePending(id: string): Proposal {
    const p = this.proposals.get(id);
    if (!p) throw new HttpError(404, `unknown proposal: ${id}`);
    if (p.status !== "pending") throw new HttpError(409, `proposal ${id} is not pending (${p.status})`);
    return p;
  }

  private spec(name: string): TableSpec {
    const spec = this.deps.tables().find((t) => t.name === name);
    if (!spec) throw new HttpError(404, `unknown table: ${name}`);
    return spec;
  }

  private tooMany(): HttpError {
    return new HttpError(
      400,
      `a proposal may change at most ${MAX_PROPOSAL_ROWS} rows; split it into smaller proposals`,
    );
  }
}
