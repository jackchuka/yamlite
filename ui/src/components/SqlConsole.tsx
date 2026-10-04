import { sql as sqlLang } from "@codemirror/lang-sql";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { useMutation } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { History, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { loadHistory, pushHistory } from "@/lib/history";
import { useEventStore, useMeta } from "@/lib/providers";
import { recordFileOf } from "@/lib/reflect";
import { isReadOnly } from "@/lib/mode";
import { needsConfirm } from "@/lib/sqlguard";
import type { ChangeOp } from "@/lib/types";
import { Grid } from "./Grid";
import { NewTableDialog } from "./NewTableDialog";

const OP_LABEL: Record<ChangeOp, string> = { toFile: "M", deleteFile: "−", toDb: "M", deleteDb: "−" };
const isDark = () => document.documentElement.dataset.theme === "dark";

export function SqlConsole() {
  const { data: meta } = useMeta();
  const store = useEventStore();
  const [history, setHistory] = useState(loadHistory);
  const [text, setText] = useState(() => history[0] ?? "select * from ");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [touched, setTouched] = useState<Array<{ table: string; key: string; op: ChangeOp }>>([]);
  const [adopt, setAdopt] = useState<string | null>(null);
  const stopListening = useRef<() => void>(() => {});
  // the files a write reaches arrive as sync events, possibly before the response, so listen from the start
  const listenForFiles = () => {
    stopListening.current();
    setTouched([]);
    const unlisten = store.listen((e) => {
      if (e.type !== "sync") return;
      const files = e.changes.filter((c) => c.op === "toFile" || c.op === "deleteFile");
      if (files.length > 0)
        setTouched((prev) => [...prev, ...files.map((c) => ({ table: e.table, key: c.key, op: c.op }))]);
    });
    const timer = setTimeout(unlisten, 10_000);
    stopListening.current = () => {
      clearTimeout(timer);
      unlisten();
    };
  };
  useEffect(() => () => stopListening.current(), []);
  const run = useMutation({
    mutationFn: (sql: string) => api.sql(sql),
    onMutate: listenForFiles,
    onSuccess: (r, sql) => {
      setHistory(pushHistory(sql));
      if ("columns" in r) {
        stopListening.current();
        setTouched([]);
      }
    },
    onError: () => {
      stopListening.current();
      setTouched([]);
    },
  });

  const submitRef = useRef<() => void>(() => {});
  submitRef.current = () => {
    if (run.isPending) return;
    const reason = isReadOnly() ? null : needsConfirm(text);
    if (reason) setConfirm(reason);
    else run.mutate(text);
  };
  const extensions = useMemo(
    () => [
      sqlLang({ schema: Object.fromEntries((meta?.tables ?? []).map((t) => [t.name, Object.keys(t.columns)])) }),
      Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => (submitRef.current(), true) }])),
    ],
    [meta],
  );
  const fileOf = recordFileOf(meta);
  const result = run.data;

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 border-b px-[18px] py-3">
        <h1 className="text-lg font-semibold tracking-tight">SQL console</h1>
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={history.length === 0}>
              <History className="size-3.5" /> History
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-w-[480px]">
            {history.map((h) => (
              <DropdownMenuItem key={h} className="truncate font-mono text-[12px]" onSelect={() => setText(h)}>
                {h}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" onClick={() => submitRef.current()} disabled={run.isPending}>
          <Play className="size-3.5" /> Run ⌘↵
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-[18px] py-3.5">
        <CodeMirror
          aria-label="SQL"
          value={text}
          onChange={setText}
          extensions={extensions}
          theme={isDark() ? "dark" : "light"}
          minHeight="110px"
          className="overflow-hidden rounded-lg border text-[12.5px]"
        />
        {run.isError && (
          <div role="alert" className="rounded-md bg-err-soft px-3 py-2 font-mono text-[12px] text-err">
            {run.error.message}
          </div>
        )}
        {result && "columns" in result && (
          <>
            <div className="text-[11.5px] text-muted-foreground">
              {result.rows.length} rows{result.truncated ? "（先頭 1000 行）" : ""} · {result.ms} ms
            </div>
            <Grid
              columns={result.columns.map((name) => ({ name, type: "TEXT" as const }))}
              rows={result.rows.map((r, i) => ({ ...r, __row: i }))}
              keyCol="__row"
            />
          </>
        )}
        {result && !("columns" in result) && (
          <>
            <div className="flex gap-3 text-[11.5px] text-muted-foreground">
              <span className="text-ok">
                ✓ {result.changes} {result.changes === 1 ? "row" : "rows"} changed
              </span>
              <span>{result.ms} ms</span>
            </div>
            {result.unmanaged && (
              <div className="flex items-center gap-3 rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">
                {result.unmanaged} は yamlite.yaml にないため同期されません。
                <Button size="sm" variant="outline" onClick={() => setAdopt(result.unmanaged ?? null)}>
                  yamlite.yaml に追加
                </Button>
              </div>
            )}
            {touched.length > 0 && (
              <div className="rounded-lg border px-3 py-2 font-mono text-[12px] leading-[1.8]">
                <div className="font-sans text-[11px] text-muted-foreground">変更されたファイル</div>
                {touched.map((t, i) => (
                  <div key={`${i}-${t.table}-${t.key}`}>
                    <span className="mr-1.5 font-bold text-warn">{OP_LABEL[t.op]}</span>
                    {fileOf(t.table, t.key)}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {confirm && (
        <Dialog open onOpenChange={(open) => !open && setConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>実行しますか？</DialogTitle>
              <DialogDescription>{confirm}</DialogDescription>
            </DialogHeader>
            <pre className="max-h-40 overflow-auto rounded bg-panel p-2 font-mono text-[12px]">{text}</pre>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)}>
                キャンセル
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirm(null);
                  run.mutate(text);
                }}
              >
                実行
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {adopt && <NewTableDialog open adopt={adopt} onOpenChange={(open) => !open && setAdopt(null)} />}
    </section>
  );
}
