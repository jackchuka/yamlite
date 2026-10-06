import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { changedFields } from "@/lib/form";
import { restoreDraft, since, type useRecordHistory, valueText } from "@/lib/recordHistory";
import type { HistoryEntry, Row } from "@/lib/types";
import { cn } from "@/lib/utils";

const short = (sha: string) => sha.slice(0, 7);
const entryId = (e: HistoryEntry) => e.sha ?? "wip";

function Empty({ title, children }: { title: string; children: string }) {
  return (
    <div className="px-2 py-10 text-center text-[13px] text-muted-foreground">
      <p className="mb-1.5 text-[15px] font-semibold text-foreground">{title}</p>
      {children}
    </div>
  );
}

function Chip({ children }: { children: string }) {
  return <span className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground">{children}</span>;
}

function YamlDiff({ table, recordKey, rev }: { table: string; recordKey: string; rev: string }) {
  const { data, error } = useQuery({
    queryKey: ["history", table, recordKey, "diff", rev],
    queryFn: () => api.historyDiff(table, recordKey, rev),
  });
  if (error) return <p className="text-[12px] text-err">{error.message}</p>;
  if (!data) return <p className="text-[12px] text-muted-foreground">読み込み中…</p>;
  return (
    <pre className="overflow-x-auto rounded-md bg-panel py-2 font-mono text-[12px] leading-relaxed">
      {data.text.split("\n").map((line, i) => (
        <span
          key={i}
          className={cn(
            "block px-3 whitespace-pre",
            line.startsWith("+") && !line.startsWith("+++") && "bg-ok/15 text-ok",
            line.startsWith("-") && !line.startsWith("---") && "bg-err-soft text-err",
          )}
        >
          {line}
        </span>
      ))}
    </pre>
  );
}

interface Props {
  table: string;
  recordKey: string;
  query: ReturnType<typeof useRecordHistory>;
  current: Row;
  keyColumn: string;
  canRestore: boolean;
  onRestore: (record: Row, sha: string) => void;
}

function Detail({ entry, ...props }: Props & { entry: HistoryEntry }) {
  const [view, setView] = useState<"fields" | "yaml">("fields");
  const record = entry.record;
  const restorable =
    record !== null && changedFields(props.current, restoreDraft(props.current, record, props.keyColumn)).length > 0;
  const showYaml = view === "yaml" || entry.changes.length === 0;
  return (
    <div className="rounded-b-lg border border-t-0 p-3">
      <div className="mb-2.5 flex items-center gap-2">
        {entry.changes.length > 0 ? (
          <div className="inline-flex overflow-hidden rounded-md border text-[12px]">
            {(["fields", "yaml"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn("px-2.5 py-0.5", view === v && "bg-foreground text-background")}
              >
                {v === "fields" ? "Fields" : "YAML diff"}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[12px] text-muted-foreground">
            {entry.unreadable ? "読めない版です" : "値の変更はありません"}
          </span>
        )}
        {entry.kind === "commit" && entry.sha && record !== null && props.canRestore && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={!restorable}
            title={restorable ? "この時点の値をフォームに入れます（保存はしません）" : "今の値と同じです"}
            onClick={() => props.onRestore(record, entry.sha as string)}
          >
            この版に戻す
          </Button>
        )}
      </div>
      {showYaml ? (
        <YamlDiff table={props.table} recordKey={props.recordKey} rev={entryId(entry)} />
      ) : (
        entry.changes.map((c) => (
          <div key={c.path} className="grid grid-cols-[7rem_1fr] gap-2 border-b border-dashed py-2 last:border-b-0">
            <span className="font-mono text-[12px] break-all text-muted-foreground">{c.path}</span>
            <span className="flex min-w-0 flex-col gap-1 font-mono text-[12px]">
              {c.from !== null && (
                <span className="rounded bg-err-soft px-2 py-0.5 break-all text-err line-through">
                  {valueText(c.from)}
                </span>
              )}
              <span className="rounded bg-ok/15 px-2 py-0.5 break-all text-ok">{valueText(c.to)}</span>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export function RecordHistory(props: Props) {
  const { query } = props;
  const [open, setOpen] = useState<string | null>(null);
  if (query.error) return <p className="text-[13px] text-err">{query.error.message}</p>;
  const first = query.data?.pages[0];
  if (!query.data || !first) return <p className="text-[13px] text-muted-foreground">読み込み中…</p>;
  if (first.state === "nogit") {
    return <Empty title="git の履歴はありません">このフォルダは git リポジトリの外にあります。</Empty>;
  }
  if (first.state === "untracked") {
    return <Empty title="まだコミットされていません">コミットすると、ここに変更が並びます。</Empty>;
  }
  if (first.state === "error") return <p className="text-[13px] text-err">{first.message}</p>;
  const entries = query.data.pages.flatMap((p) => (p.state === "ok" ? p.entries : []));
  const now = Date.now();
  return (
    <div>
      <ol className="relative m-0 list-none p-0 before:absolute before:top-3.5 before:bottom-3.5 before:left-[11px] before:w-0.5 before:bg-border">
        {entries.map((e) => {
          const id = entryId(e);
          const expanded = open === id;
          return (
            <li key={id} className="relative mb-1.5 pl-8">
              <span
                className={cn(
                  "absolute top-3.5 left-1 size-4 rounded-full border-2 border-muted-foreground bg-background",
                  e.kind === "wip" && "border-dashed border-warn",
                  e.head && "border-tomato",
                  expanded && "border-primary bg-primary",
                )}
              />
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : id)}
                className={cn(
                  "block w-full rounded-lg border border-transparent px-3 py-2 text-left hover:bg-panel",
                  expanded && "rounded-b-none border-border bg-panel",
                )}
              >
                <span className="flex items-baseline gap-2 text-[14px] font-semibold">
                  {e.kind === "wip" ? "未コミットの変更" : e.subject}
                  {e.kind === "wip" && (
                    <span className="rounded bg-warn-soft px-1.5 text-[11px] text-warn">未コミット</span>
                  )}
                  {e.head && <span className="rounded bg-chip px-1.5 text-[11px] text-chip-foreground">HEAD</span>}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                  {e.sha && <span className="font-mono text-foreground">{short(e.sha)}</span>}
                  {e.author && <span>{e.author}</span>}
                  <span>{since(e.date, now)}</span>
                </span>
                {e.renamedFrom ? (
                  <span className="mt-1 block font-mono text-[12px] text-muted-foreground">
                    {e.renamedFrom} → {e.path}
                  </span>
                ) : (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {e.event === "created" && <Chip>作成</Chip>}
                    {e.event === "deleted" && <Chip>削除</Chip>}
                    {e.changes.map((c) => (
                      <Chip key={c.path}>{c.path}</Chip>
                    ))}
                  </span>
                )}
              </button>
              {expanded && <Detail {...props} entry={e} />}
            </li>
          );
        })}
      </ol>
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          className="mt-2 ml-8 text-[12px] text-muted-foreground"
        >
          さらに古い履歴を読み込む
        </button>
      )}
    </div>
  );
}
