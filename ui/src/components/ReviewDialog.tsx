import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ExternalLink, Trash2, Undo2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type ChangeKind,
  GIT_KEY,
  gitApi,
  type GitChange,
  type GitState,
  groupChanges,
  type RecordChange,
  type Reverted,
  undoRevert,
} from "@/lib/git";
import { useMeta } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { m } from "@/paraglide/messages.js";
import { FieldDiff } from "./FieldDiff";

const KIND: Record<ChangeKind, () => string> = {
  added: m.review_status_added,
  modified: m.review_status_modified,
  deleted: m.review_status_deleted,
};

const KIND_CLASS: Record<ChangeKind, string> = {
  added: "text-ok",
  modified: "text-warn",
  deleted: "text-err",
};

type Target = { table: string; key: string; delete?: boolean };
type Targets = { records: Target[]; files: string[] };

// what the bulk button puts back: an added record or file has no committed version, so it is only ever removed one
// by one; a file that is not read as records goes back whole
const revertable = (c: GitChange): Targets =>
  c.records === null
    ? { records: [], files: c.status === "added" ? [] : [c.path] }
    : {
        records:
          c.table === null
            ? []
            : c.records
                .filter((r) => r.kind === "deleted" || r.fields.length > 0)
                .map((r) => ({ table: c.table as string, key: r.key })),
        files: [],
      };

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));

function FileDiff({ path, many }: { path: string; many: boolean }) {
  const { data, error } = useQuery({ queryKey: ["gitdiff", path], queryFn: () => gitApi.diff(path) });
  if (error) return <p className="text-[13px] text-err">{error.message}</p>;
  if (!data) return <p className="text-[13px] text-muted-foreground">{m.review_loading()}</p>;
  return (
    <div className="flex flex-col gap-3">
      {data.records.map((r) => (
        <div key={r.key} className="flex flex-col gap-1.5">
          {many && <div className="font-mono text-[13px] font-semibold">{r.key}</div>}
          {r.fields.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{m.review_format_only()}</p>
          ) : (
            <FieldDiff
              labels={[m.review_committed(), m.review_now()]}
              format={show}
              rows={r.fields.map((f) => ({ field: f.field, a: f.from, b: f.to }))}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function RecordActions({
  table,
  record,
  busy,
  onRevert,
}: {
  table: string;
  record: RecordChange;
  busy: boolean;
  onRevert: (t: Targets) => void;
}) {
  if (record.kind === "added")
    return (
      <ConfirmAction
        label={m.review_delete_record({ record: record.key })}
        confirm={m.review_delete_confirm()}
        remove
        busy={busy}
        onConfirm={() => onRevert({ records: [{ table, key: record.key, delete: true }], files: [] })}
      />
    );
  return (
    <button
      type="button"
      aria-label={m.review_revert_record({ record: record.key })}
      title={m.review_revert_record({ record: record.key })}
      // a change to formatting or comments only has no values to put back
      disabled={busy || (record.kind === "modified" && record.fields.length === 0)}
      className="rounded p-1 text-muted-foreground hover:bg-panel-2 hover:text-foreground disabled:opacity-30"
      onClick={() => onRevert({ records: [{ table, key: record.key }], files: [] })}
    >
      <Undo2 className="size-4" />
    </button>
  );
}

// a file goes back whole, which cannot be undone, so it is asked for twice
function FileActions({ change, busy, onRevert }: { change: GitChange; busy: boolean; onRevert: (t: Targets) => void }) {
  const added = change.status === "added";
  return (
    <ConfirmAction
      label={added ? m.review_delete_record({ record: change.path }) : m.review_revert_record({ record: change.path })}
      confirm={added ? m.review_delete_confirm() : m.review_revert_confirm()}
      remove={added}
      busy={busy}
      onConfirm={() => onRevert({ records: [], files: [change.path] })}
    />
  );
}

// asks a second time for what cannot be undone; looking away, or an attempt that ends, asks again from the start
function ConfirmAction({
  label,
  confirm,
  remove = false,
  busy,
  onConfirm,
}: {
  label: string;
  confirm: string;
  remove?: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!busy) setArmed(false);
  }, [busy]);
  if (armed)
    return (
      <Button
        size="sm"
        variant="destructive"
        className="h-6 px-2 text-[12.5px]"
        autoFocus
        disabled={busy}
        onBlur={() => setArmed(false)}
        onClick={onConfirm}
      >
        {confirm}
      </Button>
    );
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      className={cn(
        "rounded p-1 text-muted-foreground hover:bg-panel-2 disabled:opacity-50",
        remove ? "hover:text-err" : "hover:text-foreground",
      )}
      onClick={() => setArmed(true)}
    >
      {remove ? <Trash2 className="size-4" /> : <Undo2 className="size-4" />}
    </button>
  );
}

function Line({
  label,
  kind,
  fields,
  action,
}: {
  label: string;
  kind: ChangeKind;
  fields?: string[];
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 truncate font-mono text-[13.5px]">{label}</span>
      {fields && fields.length > 0 && (
        <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">{fields.join(", ")}</span>
      )}
      <span className={cn("ml-auto shrink-0 text-[12.5px]", KIND_CLASS[kind])}>{KIND[kind]()}</span>
      <span className="flex min-w-7 shrink-0 justify-end">{action}</span>
    </div>
  );
}

function FileRow({
  change,
  list,
  checked,
  busy,
  onToggle,
  onRevert,
}: {
  change: GitChange;
  // a list file holds many records; a files table's file is one record
  list: boolean;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
  onRevert: (t: Targets) => void;
}) {
  const [open, setOpen] = useState(false);
  const { table, records } = change;
  const one = !list && table !== null && records?.length === 1 ? records[0]! : null;
  return (
    <div className="flex flex-col gap-1 rounded-md px-1 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          aria-label={m.review_include({ file: change.path })}
          checked={checked}
          onChange={onToggle}
        />
        {records && records.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={m.review_show_diff({ file: change.path })}
            className="rounded p-0.5 text-muted-foreground hover:bg-panel-2"
            onClick={() => setOpen(!open)}
          >
            <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        {one && table ? (
          <Line
            label={one.key}
            kind={one.kind}
            fields={one.fields}
            action={<RecordActions table={table} record={one} busy={busy} onRevert={onRevert} />}
          />
        ) : (
          <Line
            label={change.path}
            kind={change.status}
            action={records === null && <FileActions change={change} busy={busy} onRevert={onRevert} />}
          />
        )}
      </div>
      {!one && table && records && records.length > 0 && (
        <div className="ml-12 flex flex-col gap-1">
          {records.map((r) => (
            <Line
              key={r.key}
              label={r.key}
              kind={r.kind}
              fields={r.fields}
              action={<RecordActions table={table} record={r} busy={busy} onRevert={onRevert} />}
            />
          ))}
        </div>
      )}
      {open && (
        <div className="mt-1 ml-12 border-t pt-2">
          <FileDiff path={change.path} many={!one} />
        </div>
      )}
    </div>
  );
}

export function ReviewDialog({
  git,
  open,
  onOpenChange,
}: {
  git: GitState;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const client = useQueryClient();
  const { data: meta } = useMeta();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [branch, setBranch] = useState("");
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  // the set the bulk button was armed for; a different set, as after a refetch, asks again
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const paths = git.changes.map((c) => c.path).filter((p) => !unchecked.has(p));
  const onDefault = git.branch === git.defaultBranch;
  const refresh = () => void client.invalidateQueries({ queryKey: GIT_KEY });
  const send = useMutation({
    mutationFn: () =>
      gitApi.review({
        title: title.trim(),
        body,
        paths,
        ...(onDefault && branch.trim() ? { branch: branch.trim() } : {}),
      }),
    onSettled: refresh,
  });
  const undo = (items: Reverted[]) =>
    void undoRevert(items)
      .then(refresh)
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
  const revert = useMutation({
    mutationFn: (targets: Targets) => gitApi.revert(targets),
    // a file written back has nothing to undo it with, so undo is offered only when records alone went back
    onSuccess: ({ reverted, files }) =>
      toast.success(
        m.review_reverted({ count: reverted.length + files.length }),
        files.length > 0 ? {} : { action: { label: m.review_undo(), onClick: () => undo(reverted) } },
      ),
    onSettled: () => {
      setArmedFor(null);
      refresh();
    },
  });
  const busy = send.isPending || revert.isPending;
  const chosen = git.changes.filter((c) => !unchecked.has(c.path)).map(revertable);
  const bulk = { records: chosen.flatMap((t) => t.records), files: chosen.flatMap((t) => t.files) };
  const bulkCount = bulk.records.length + bulk.files.length;
  const bulkKey = JSON.stringify(bulk);
  const confirmBulk = armedFor === bulkKey;
  const toggle = (path: string) => {
    setUnchecked((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  };
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      send.reset();
      revert.reset();
      setTitle("");
      setBody("");
      setBranch("");
      setUnchecked(new Set());
      setArmedFor(null);
    }
  };
  const empty = git.changes.length === 0;
  useEffect(() => {
    if (empty && !send.data) onOpenChange(false);
  }, [empty, send.data, onOpenChange]);
  const listTables = new Set(meta?.tables.filter((t) => t.mode === "list").map((t) => t.name));
  const result = send.data;
  const failure = send.error ?? revert.error;
  const error = failure instanceof Error ? failure.message : (result?.error ?? null);
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="sm:max-w-2xl"
        // the undo toast sits outside the dialog; using it must not close the dialog
        onInteractOutside={(e) => {
          if (e.target instanceof Element && e.target.closest("[data-sonner-toaster]")) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-[18px]">{m.review_title()}</DialogTitle>
          <DialogDescription className="text-[14px]">{onDefault ? m.review_new() : m.review_add()}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="flex flex-col gap-3 text-[15px]">
            {!result.error && <p>{m.review_sent()}</p>}
            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-semibold text-tomato hover:underline"
              >
                {result.created ? m.review_open_pr() : m.review_create_pr()}
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
        ) : (
          <>
            <fieldset className="flex max-h-[45vh] flex-col gap-2 overflow-auto rounded-md border p-3 text-[14px]">
              <legend className="px-1 text-[13px] text-muted-foreground">
                {m.review_files({ count: paths.length })}
              </legend>
              {groupChanges(git.changes).map((g) => (
                <div key={g.table ?? ""} className="flex flex-col gap-0.5">
                  <div className="text-[12.5px] font-semibold text-muted-foreground">
                    {g.table ?? m.review_other_files()}
                  </div>
                  {g.changes.map((c) => (
                    <FileRow
                      key={c.path}
                      change={c}
                      list={c.table !== null && listTables.has(c.table)}
                      checked={!unchecked.has(c.path)}
                      busy={busy}
                      onToggle={() => toggle(c.path)}
                      onRevert={(t) => revert.mutate(t)}
                    />
                  ))}
                </div>
              ))}
            </fieldset>
            {onDefault && git.namesBranch && (
              <Input
                aria-label={m.review_branch()}
                placeholder={m.review_branch()}
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="font-mono text-[15px]"
              />
            )}
            <Input
              aria-label={m.review_pr_title()}
              placeholder={m.review_pr_title()}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-[15px]"
            />
            <Textarea
              aria-label={m.review_pr_body()}
              placeholder={m.review_pr_body()}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-20 text-[15px]"
            />
          </>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-err">
            {error}
          </p>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => close(false)}>{m.common_close()}</Button>
          ) : (
            <>
              <Button
                variant={confirmBulk ? "destructive" : "outline"}
                className="sm:mr-auto"
                disabled={bulkCount === 0 || busy}
                onClick={() => (bulk.files.length > 0 && !confirmBulk ? setArmedFor(bulkKey) : revert.mutate(bulk))}
              >
                <Undo2 className="size-4" />
                {confirmBulk
                  ? m.review_revert_selected_confirm({ count: bulkCount })
                  : m.review_revert_selected({ count: bulkCount })}
              </Button>
              <Button variant="outline" onClick={() => close(false)}>
                {m.common_cancel()}
              </Button>
              <Button disabled={title.trim() === "" || paths.length === 0 || busy} onClick={() => send.mutate()}>
                {send.isPending ? m.review_sending() : m.review_send()}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
