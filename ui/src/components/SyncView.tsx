import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { activityLines, warningLinks } from "@/lib/activity";
import { ApiError, api } from "@/lib/api";
import { diffRows, restoreLabel } from "@/lib/diff";
import { useEvents, useEventStore, useMeta } from "@/lib/providers";
import { formatClock } from "@/lib/format";
import type { ConflictDetail, ConflictEntry } from "@/lib/types";
import { useIsMobile } from "@/lib/useIsMobile";
import { FieldDiff } from "./FieldDiff";
import { m } from "@/paraglide/messages.js";

const TONE = { ok: "text-ok", warn: "text-warn", err: "text-err", muted: "text-muted-foreground" } as const;
const show = (v: unknown) => (v === undefined ? "—" : JSON.stringify(v));

function Diff({ entry, detail, keyCol }: { entry: ConflictEntry; detail: ConflictDetail; keyCol?: string }) {
  return (
    <FieldDiff
      className="md:text-[11.5px]"
      labels={[<span className="text-ok">{m.sync_kept({ winner: entry.winner ?? "" })}</span>, m.sync_backup()]}
      note={detail.deleted ? m.sync_deleted_on_backup() : undefined}
      format={show}
      rows={diffRows(detail.current, detail.saved, keyCol).map((d) => ({
        field: d.field,
        a: d.winner,
        b: d.saved,
        dim: d.same,
      }))}
    />
  );
}

function ConflictItem({ entry }: { entry: ConflictEntry }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const client = useQueryClient();
  const { connected } = useEvents();
  const mobile = useIsMobile();
  const { data: meta } = useMeta();
  const keyCol = meta?.tables.find((t) => t.name === entry.table)?.key;
  const detail = useQuery({
    queryKey: ["conflict", entry.id],
    queryFn: () => api.conflict(entry.id),
    enabled: open || confirming,
  });
  const done = (message: string) => {
    void client.invalidateQueries({ queryKey: ["conflicts"] });
    toast.success(message);
  };
  const restore = useMutation({
    mutationFn: (expected: ConflictDetail["current"]) => api.restore(entry.id, expected),
    onSuccess: () => {
      setConfirming(false);
      done(m.sync_restored({ table: entry.table, key: entry.key ?? "" }));
    },
    onError: (e) => {
      toast.error(e.message);
      if (e instanceof ApiError && e.status === 409)
        void client.invalidateQueries({ queryKey: ["conflict", entry.id] });
    },
  });
  const dismiss = useMutation({
    mutationFn: () => api.dismiss(entry.id),
    onSuccess: () => done(m.sync_dismissed()),
    onError: (e) => toast.error(e.message),
  });
  const restoreTitle = !connected
    ? m.common_disconnected_hint()
    : entry.restorable
      ? undefined
      : m.sync_restore_unknown_key();
  return (
    <div className="border-b px-3.5 py-2.5 text-[12px] last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left max-md:basis-full max-md:flex-wrap"
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span className="font-semibold">
            {entry.table} / {entry.key ?? entry.file}
          </span>
          <span className="truncate text-[11.5px] text-muted-foreground max-md:basis-full max-md:pl-5 max-md:text-[12.5px] max-md:whitespace-normal">
            {formatClock(entry.at)} · {entry.winner ? m.sync_winner({ winner: entry.winner }) : m.sync_no_header()}
          </span>
        </button>
        <Button
          size={mobile ? "default" : "sm"}
          variant="outline"
          disabled={!connected || !entry.restorable || restore.isPending}
          title={restoreTitle}
          onClick={() => setConfirming(true)}
        >
          {restoreLabel(entry.restorable ? entry.winner : null)}
        </Button>
        <Button
          size={mobile ? "default" : "sm"}
          variant="ghost"
          disabled={!connected || dismiss.isPending}
          title={connected ? undefined : m.common_disconnected_hint()}
          onClick={() => dismiss.mutate()}
        >
          {m.sync_dismiss()}
        </Button>
      </div>
      {mobile && restoreTitle && <p className="mt-1 text-[12px] text-muted-foreground">{restoreTitle}</p>}
      {open && detail.data && (
        <div className="mt-2">
          <Diff entry={entry} detail={detail.data} keyCol={keyCol} />
        </div>
      )}
      {confirming && (
        <Dialog open onOpenChange={(o) => !o && setConfirming(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{m.sync_restore_title({ table: entry.table, key: entry.key ?? "" })}</DialogTitle>
            </DialogHeader>
            {detail.data ? (
              <Diff entry={entry} detail={detail.data} keyCol={keyCol} />
            ) : (
              <p className="text-[12px] text-muted-foreground">
                {detail.error ? detail.error.message : m.common_loading()}
              </p>
            )}
            <p className="text-[12px] text-muted-foreground">{m.sync_restore_note()}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {m.common_cancel()}
              </Button>
              <Button
                disabled={!detail.data || restore.isPending}
                onClick={() => detail.data && restore.mutate(detail.data.current)}
              >
                {restoreLabel(entry.winner)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Card({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count?: number;
  tone?: "warn" | "err";
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3.5 overflow-hidden rounded-[10px] border">
      <h3 className="flex items-center gap-2 border-b bg-panel px-3.5 py-2.5 text-[13px] font-semibold">
        {count !== undefined && count > 0 && (
          <span
            className={`rounded-full px-1.5 text-[10.5px] ${tone === "err" ? "bg-err-soft text-err" : "bg-warn-soft text-warn"}`}
          >
            {count}
          </span>
        )}
        {title}
      </h3>
      {children}
    </div>
  );
}

export function SyncView() {
  const store = useEventStore();
  const { activity, warnings, connected, lastSyncAt } = useEvents();
  const { data } = useQuery({ queryKey: ["conflicts"], queryFn: api.conflicts });
  useEffect(() => store.markConflictsSeen(), [store]);
  const conflicts = data?.conflicts ?? [];
  const { data: meta } = useMeta();
  const warningList = warningLinks(warnings, new Set(meta?.views.map((v) => v.name)));
  const lines = activityLines(activity);
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2.5 border-b px-[18px] py-3 max-md:px-3">
        <h1 className="max-md:sr-only text-lg font-semibold tracking-tight">{m.nav_sync()}</h1>
        <span className="text-[12px] text-muted-foreground">
          {connected ? m.sync_watching() : m.status_disconnected()}
          {lastSyncAt && m.sync_last_sync({ at: formatClock(lastSyncAt) })}
        </span>
      </div>
      <div className="overflow-auto px-[18px] py-3.5 max-md:px-3">
        <Card title={m.sync_conflicts()} count={conflicts.length} tone="err">
          {conflicts.length === 0 ? (
            <p className="px-3.5 py-2.5 text-[12px] text-muted-foreground">{m.sync_no_conflicts()}</p>
          ) : (
            conflicts.map((c) => <ConflictItem key={c.id} entry={c} />)
          )}
        </Card>
        <Card title={m.sync_warnings()} count={warningList.length} tone="warn">
          {warningList.length === 0 ? (
            <p className="px-3.5 py-2.5 text-[12px] text-muted-foreground">{m.sync_no_warnings()}</p>
          ) : (
            warningList.map((w, i) => (
              <div
                key={`${i}-${w.text}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3.5 py-2 text-[12px] last:border-b-0 max-md:text-[13px]"
              >
                <span className="font-semibold">
                  {w.table}
                  {w.key && ` / ${w.key}`}
                  {w.view && ` / ${w.view}`}
                </span>
                <span className="flex-1 text-muted-foreground max-md:order-last max-md:basis-full">{w.text}</span>
                {w.key && (
                  <Link
                    to="/t/$table"
                    params={{ table: w.table }}
                    search={{ key: w.key }}
                    className="text-tomato max-md:py-1.5"
                  >
                    {m.sync_open()}
                  </Link>
                )}
                {w.view && (
                  <Link to="/t/$table" params={{ table: w.view }} className="text-tomato max-md:py-1.5">
                    {m.sync_open()}
                  </Link>
                )}
              </div>
            ))
          )}
        </Card>
        <Card title={m.sync_activity()}>
          {lines.length === 0 ? (
            <p className="px-3.5 py-2.5 text-[12px] text-muted-foreground">{m.sync_no_activity()}</p>
          ) : (
            lines.map((l, i) => (
              <div
                key={`${i}-${l.at}-${l.text}`}
                className="flex flex-wrap gap-x-3 border-b px-3.5 py-2 text-[12px] last:border-b-0 max-md:text-[13px]"
              >
                <span className={`w-3 font-mono font-bold ${TONE[l.tone]}`}>{l.symbol}</span>
                <span className="font-semibold">{l.text}</span>
                <span className="text-muted-foreground">
                  {formatClock(l.at)} · {l.detail}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>
    </section>
  );
}
