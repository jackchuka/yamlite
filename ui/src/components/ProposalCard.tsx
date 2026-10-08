import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { agentApi, invalidateProposals, type Proposal, type ProposalRow } from "@/lib/agent";
import { diffJson, isStructured, type JsonChange } from "@/lib/jsondiff";
import { cn } from "@/lib/utils";
import { FieldDiff } from "./FieldDiff";
import { m } from "@/paraglide/messages.js";

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));
const OP = { insert: m.proposal_op_insert, update: m.proposal_op_update, delete: m.proposal_op_delete } as const;

const OUTCOME: Record<Exclude<Proposal["status"], "pending">, () => string> = {
  applied: m.proposal_applied,
  discarded: m.proposal_discarded,
  stale: m.proposal_stale,
  failed: m.proposal_failed,
};

const CHANGE_LABEL = {
  added: m.proposal_change_added,
  removed: m.proposal_change_removed,
  changed: m.proposal_change_changed,
} as const;
const COLLAPSE_AFTER = 200;
const MAX_ROWS = 50;

function JsonValue({ value }: { value: unknown }) {
  const text = JSON.stringify(value) ?? "null";
  const [open, setOpen] = useState(false);
  const long = text.length > COLLAPSE_AFTER;
  return (
    <div className="min-w-0">
      <p className={cn("font-mono text-[14px] [overflow-wrap:anywhere]", long && !open && "line-clamp-6")}>{text}</p>
      {long && (
        <button type="button" className="text-[14px] text-muted-foreground underline" onClick={() => setOpen(!open)}>
          {open ? m.proposal_collapse() : m.proposal_show_all()}
        </button>
      )}
    </div>
  );
}

function JsonChanges({ field, before, after }: { field: string; before: unknown; after: unknown }) {
  const all: JsonChange[] = useMemo(() => diffJson({ [field]: before }, { [field]: after }), [field, before, after]);
  const changes = all.slice(0, MAX_ROWS);
  if (all.length === 0)
    return (
      <p className="text-[14px] text-muted-foreground">
        <span className="font-mono">{field}</span> <span>{m.proposal_order_only()}</span>
      </p>
    );
  return (
    <ul aria-label={field} className="flex flex-col gap-2">
      {changes.map((c) => (
        <li key={`${c.kind}:${c.path}`} className="flex min-w-0 flex-col gap-1 rounded-md border bg-panel px-2.5 py-2">
          <div className="flex items-baseline gap-2 text-[14px]">
            <span
              className={cn(
                "shrink-0 rounded-full border px-2",
                c.kind === "removed"
                  ? "border-err text-err"
                  : c.kind === "added"
                    ? "border-ok text-ok"
                    : "text-muted-foreground",
              )}
            >
              {CHANGE_LABEL[c.kind]()}
            </span>
            <span className="font-mono [overflow-wrap:anywhere]">{c.path}</span>
          </div>
          {c.kind !== "added" && <JsonValue value={c.before} />}
          {c.kind === "changed" && <span className="text-[14px] text-muted-foreground">→</span>}
          {c.kind !== "removed" && <JsonValue value={c.after} />}
        </li>
      ))}
      {all.length > MAX_ROWS && (
        <li className="text-[14px] text-muted-foreground">{m.proposal_more({ count: all.length - MAX_ROWS })}</li>
      )}
    </ul>
  );
}

function RowDiff({ row }: { row: ProposalRow }) {
  const fields = row.op === "update" ? row.changed : Object.keys(row.after ?? row.before ?? {});
  const structured = (f: string) =>
    row.op === "update" && isStructured(row.before?.[f]) && isStructured(row.after?.[f]);
  const scalars = fields.filter((f) => !structured(f));
  return (
    <div className="flex flex-col gap-1.5 border-b border-dashed py-2.5 last:border-b-0">
      <div className="flex items-center gap-2 text-[14px]">
        <span className="font-mono text-muted-foreground">{row.key}</span>
        <span
          className={cn(
            "rounded-full border px-2 text-[14px]",
            row.op === "delete" ? "border-err text-err" : "border-ok text-ok",
          )}
        >
          {OP[row.op]()}
        </span>
      </div>
      {row.op !== "delete" && scalars.length > 0 && (
        <FieldDiff
          labels={[m.proposal_before(), m.proposal_after()]}
          format={show}
          rows={scalars.map((f) => ({ field: f, a: row.before?.[f], b: row.after?.[f] }))}
        />
      )}
      {row.op !== "delete" &&
        fields
          .filter(structured)
          .map((f) => <JsonChanges key={f} field={f} before={row.before?.[f]} after={row.after?.[f]} />)}
    </div>
  );
}

export function ProposalCard({ proposal: p }: { proposal: Proposal }) {
  const act = useMutation({
    mutationFn: (how: "apply" | "discard") => (how === "apply" ? agentApi.apply(p.id) : agentApi.discard(p.id)),
    onSettled: () => invalidateProposals(),
    onError: (e) => toast.error(e.message),
  });
  const tables = [...new Set(p.rows.map((r) => r.table))];
  const count = p.table ? 1 : p.rows.length;
  return (
    <section aria-label={m.proposal_label({ title: p.title })} className="overflow-hidden rounded-lg border">
      <header className="flex items-baseline justify-between gap-2 border-b bg-panel px-3 py-2.5">
        <h3 className="text-[16px] font-semibold">{p.title}</h3>
        <span className="text-[14px] text-muted-foreground">
          {p.table
            ? m.proposal_new_table({ name: p.table.name })
            : m.proposal_summary({ tables: tables.join(", "), count })}
        </span>
      </header>
      <div className="max-h-[360px] overflow-auto px-3">
        {p.table ? (
          <p className="py-2.5 text-[14px]">
            {(p.table.mode === "list" ? m.proposal_table_list : m.proposal_table_files)({
              name: p.table.name,
              key: p.table.key,
            })}
          </p>
        ) : (
          p.rows.map((r) => <RowDiff key={`${r.table}/${r.key}`} row={r} />)
        )}
      </div>
      {p.warnings.length > 0 && (
        <ul className="border-t bg-warn-soft px-3 py-2 text-[14px] text-warn">
          {p.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {p.sql && (
        <details className="border-t px-3 py-2 text-[14px] text-muted-foreground">
          <summary className="cursor-pointer">SQL</summary>
          <pre className="mt-1.5 font-mono text-[14px] whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
            {p.sql}
          </pre>
        </details>
      )}
      <footer className="flex items-center justify-end gap-2 border-t px-3 py-2.5">
        {p.status === "pending" ? (
          <>
            <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate("discard")}>
              {m.proposal_discard()}
            </Button>
            <Button disabled={act.isPending} onClick={() => act.mutate("apply")}>
              {m.proposal_apply({ count })}
            </Button>
          </>
        ) : (
          <p
            className={cn(
              "text-[14px]",
              p.status === "applied" ? "text-ok" : p.status === "discarded" ? "text-muted-foreground" : "text-err",
            )}
          >
            {OUTCOME[p.status]()}
            {p.stale && `: ${p.stale.join(", ")}`}
            {p.error && `: ${p.error}`}
          </p>
        )}
      </footer>
    </section>
  );
}
