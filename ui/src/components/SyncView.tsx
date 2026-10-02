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
import type { ConflictDetail, ConflictEntry } from "@/lib/types";

const TONE = { ok: "text-ok", warn: "text-warn", err: "text-err", muted: "text-muted-foreground" } as const;
const time = (at: string) => new Date(at).toLocaleTimeString();
const show = (v: unknown) => (v === undefined ? "—" : JSON.stringify(v));

function Diff({ entry, detail, keyCol }: { entry: ConflictEntry; detail: ConflictDetail; keyCol?: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 font-mono text-[11.5px]">
      <span />
      <span className="font-sans text-[10.5px] text-ok">採用: {entry.winner}</span>
      <span className="font-sans text-[10.5px] text-muted-foreground">退避</span>
      {detail.deleted && <span className="col-span-3 text-muted-foreground">退避された側では削除されていました</span>}
      {diffRows(detail.current, detail.saved, keyCol).map((d) => (
        <div key={d.field} className={`contents ${d.same ? "opacity-50" : ""}`}>
          <span className="text-syn-key">{d.field}</span>
          <span>{show(d.winner)}</span>
          <span>{show(d.saved)}</span>
        </div>
      ))}
    </div>
  );
}

function ConflictItem({ entry }: { entry: ConflictEntry }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const client = useQueryClient();
  const { connected } = useEvents();
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
      done(`${entry.table} / ${entry.key} を戻しました`);
    },
    onError: (e) => {
      toast.error(e.message);
      if (e instanceof ApiError && e.status === 409)
        void client.invalidateQueries({ queryKey: ["conflict", entry.id] });
    },
  });
  const dismiss = useMutation({
    mutationFn: () => api.dismiss(entry.id),
    onSuccess: () => done("既読にしました"),
    onError: (e) => toast.error(e.message),
  });
  const restoreTitle = !connected
    ? "disconnected"
    : entry.restorable
      ? undefined
      : "キーが分からないため、手で戻してください";
  return (
    <div className="border-b px-3.5 py-2.5 text-[12px] last:border-b-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span className="font-semibold">
            {entry.table} / {entry.key ?? entry.file}
          </span>
          <span className="truncate text-[11.5px] text-muted-foreground">
            {time(entry.at)} · {entry.winner ? `${entry.winner} を採用` : "ヘッダーなし（古い形式）"}
          </span>
        </button>
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || !entry.restorable || restore.isPending}
          title={restoreTitle}
          onClick={() => setConfirming(true)}
        >
          {restoreLabel(entry.restorable ? entry.winner : null)}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected || dismiss.isPending}
          title={connected ? undefined : "disconnected"}
          onClick={() => dismiss.mutate()}
        >
          既読
        </Button>
      </div>
      {open && detail.data && (
        <div className="mt-2">
          <Diff entry={entry} detail={detail.data} keyCol={keyCol} />
        </div>
      )}
      {confirming && (
        <Dialog open onOpenChange={(o) => !o && setConfirming(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {entry.table} / {entry.key} を戻しますか？
              </DialogTitle>
            </DialogHeader>
            {detail.data ? (
              <Diff entry={entry} detail={detail.data} keyCol={keyCol} />
            ) : (
              <p className="text-[12px] text-muted-foreground">{detail.error ? detail.error.message : "読み込み中…"}</p>
            )}
            <p className="text-[12px] text-muted-foreground">
              現在の版は新しい退避として残るので、あとでもう一度戻せます。
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                キャンセル
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
      <div className="flex items-center gap-2.5 border-b px-[18px] py-3">
        <h1 className="text-lg font-semibold tracking-tight">Sync</h1>
        <span className="text-[12px] text-muted-foreground">
          {connected ? "watching" : "disconnected"}
          {lastSyncAt && ` · last sync ${time(lastSyncAt)}`}
        </span>
      </div>
      <div className="overflow-auto px-[18px] py-3.5">
        <Card title="Conflicts" count={conflicts.length} tone="err">
          {conflicts.length === 0 ? (
            <p className="px-3.5 py-2.5 text-[12px] text-muted-foreground">コンフリクトはありません</p>
          ) : (
            conflicts.map((c) => <ConflictItem key={c.id} entry={c} />)
          )}
        </Card>
        <Card title="Warnings" count={warningList.length} tone="warn">
          {warningList.length === 0 ? (
            <p className="px-3.5 py-2.5 text-[12px] text-muted-foreground">警告はありません</p>
          ) : (
            warningList.map((w, i) => (
              <div
                key={`${i}-${w.text}`}
                className="flex items-center gap-3 border-b px-3.5 py-2 text-[12px] last:border-b-0"
              >
                <span className="font-semibold">
                  {w.table}
                  {w.key && ` / ${w.key}`}
                  {w.view && ` / ${w.view}`}
                </span>
                <span className="flex-1 text-muted-foreground">{w.text}</span>
                {w.key && (
                  <Link to="/t/$table" params={{ table: w.table }} search={{ key: w.key }} className="text-tomato">
                    開く
                  </Link>
                )}
                {w.view && (
                  <Link to="/t/$table" params={{ table: w.view }} className="text-tomato">
                    開く
                  </Link>
                )}
              </div>
            ))
          )}
        </Card>
        <Card title="Activity">
          {lines.length === 0 ? (
            <p className="px-3.5 py-2.5 text-[12px] text-muted-foreground">まだ何も同期していません</p>
          ) : (
            lines.map((l, i) => (
              <div
                key={`${i}-${l.at}-${l.text}`}
                className="flex gap-3 border-b px-3.5 py-2 text-[12px] last:border-b-0"
              >
                <span className={`w-3 font-mono font-bold ${TONE[l.tone]}`}>{l.symbol}</span>
                <span className="font-semibold">{l.text}</span>
                <span className="text-muted-foreground">
                  {time(l.at)} · {l.detail}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>
    </section>
  );
}
