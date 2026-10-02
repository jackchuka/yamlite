import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Layers, Plus, Table2, Terminal, TriangleAlert } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { warningLinks } from "@/lib/activity";
import { api } from "@/lib/api";
import { useEvents, useMeta } from "@/lib/providers";
import { cn } from "@/lib/utils";

const item = "flex items-center gap-2 rounded-md px-2.5 py-1.5 mx-1.5 text-[13px] hover:bg-panel-2";
const active = { className: cn(item, "bg-tomato text-[var(--y-on-accent)] font-semibold hover:bg-tomato") };

// a table or view with warnings shows how many in place of its icon, so its row count stays on the right
function WarnMark({ count, fallback }: { count: number; fallback: ReactNode }) {
  if (count === 0) return fallback;
  return (
    <span
      role="img"
      aria-label={`${count} warnings`}
      title={`${count} 件の警告`}
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-warn-soft px-1 text-[10.5px] font-semibold text-warn"
    >
      <TriangleAlert className="size-3" />
      {count}
    </span>
  );
}

export function Sidebar({ onNewTable }: { onNewTable?: () => void }) {
  const { data: meta } = useMeta();
  const { warnings, connected } = useEvents();
  const { data: conflicts } = useQuery({ queryKey: ["conflicts"], queryFn: api.conflicts });
  const conflictCount = conflicts?.conflicts.length ?? 0;
  const viewNames = new Set(meta?.views.map((v) => v.name));
  return (
    <aside className="flex min-h-0 flex-col border-r bg-panel" aria-label="sidebar">
      <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5 text-base font-bold tracking-tight">
        <img src="./favicon.svg" alt="" className="size-6" />
        yamlite
        <span className="ml-auto truncate font-mono text-[11px] font-normal text-muted-foreground">{meta?.root}</span>
      </div>
      <button
        type="button"
        className="mx-2.5 mb-2 flex justify-between rounded-md border bg-background px-2 py-1.5 text-[12px] text-muted-foreground"
        onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
      >
        <span>Search…</span>
        <kbd className="rounded border px-1 font-mono text-[10px]">⌘K</kbd>
      </button>
      <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
        Tables
      </div>
      <nav className="flex flex-col gap-px overflow-auto">
        {meta?.tables.map((t) => {
          const links = warningLinks({ [t.name]: warnings[t.name] ?? [] }, viewNames);
          const warnOf = (view: string | null) => links.filter((w) => w.view === view).length;
          return (
            <Fragment key={t.name}>
              <Link to="/t/$table" params={{ table: t.name }} className={item} activeProps={active}>
                <WarnMark count={warnOf(null)} fallback={<Table2 className="size-3.5 opacity-70" />} />
                {t.name}
                <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{t.count}</span>
              </Link>
              {meta.views
                .filter((v) => v.table === t.name)
                .map((v) => (
                  <Link
                    key={v.name}
                    to="/t/$table"
                    params={{ table: v.name }}
                    className={item}
                    activeProps={active}
                    style={{ paddingLeft: `${10 + v.depth * 14}px` }}
                  >
                    <WarnMark count={warnOf(v.name)} fallback={<Layers className="size-3.5 shrink-0 opacity-70" />} />
                    <span className="truncate">{v.name}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{v.count}</span>
                  </Link>
                ))}
            </Fragment>
          );
        })}
        <button
          type="button"
          disabled={!connected}
          title={connected ? undefined : "disconnected"}
          className={cn(item, "text-muted-foreground disabled:opacity-50")}
          onClick={onNewTable}
        >
          <Plus className="size-3.5" /> New table
        </button>
      </nav>
      <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
        Tools
      </div>
      <nav className="flex flex-col gap-px">
        <Link to="/sql" className={item} activeProps={active}>
          <Terminal className="size-3.5 opacity-70" /> SQL console
        </Link>
        <Link to="/sync" className={item} activeProps={active}>
          <ArrowLeftRight className="size-3.5 opacity-70" /> Sync
          {conflictCount > 0 && (
            <span className="ml-auto rounded-full bg-err-soft px-1.5 text-[10.5px] font-semibold text-err">
              {conflictCount}
            </span>
          )}
        </Link>
      </nav>
      <div className="mt-auto border-t px-3.5 py-2.5 text-[11px] text-muted-foreground">
        {meta?.configFile} · {meta?.tables.length ?? 0} tables
        <br />
        DB {meta?.db}
      </div>
    </aside>
  );
}
