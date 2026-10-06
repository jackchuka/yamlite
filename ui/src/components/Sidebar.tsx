import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  ChevronRight,
  Layers,
  LayoutDashboard,
  Network,
  Plus,
  Sparkles,
  Table2,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { agentPanel, useAgents } from "@/lib/agent";
import { warningLinks } from "@/lib/activity";
import { openCommandMenu } from "@/lib/commandMenu";
import { groupTables, useCollapsedGroups } from "@/lib/groups";
import { api } from "@/lib/api";
import { isReadOnly } from "@/lib/mode";
import { useEvents, useMeta } from "@/lib/providers";
import type { TableMeta } from "@/lib/types";
import { cn } from "@/lib/utils";
import { m } from "@/paraglide/messages.js";

const item =
  "flex items-center gap-2 rounded-md px-2.5 py-1.5 mx-1.5 text-[13px] hover:bg-panel-2 max-md:py-2.5 max-md:text-[15px]";
const active = { className: cn(item, "bg-tomato text-[var(--y-on-accent)] font-semibold hover:bg-tomato") };

// a table or view with warnings shows how many in place of its icon, so its row count stays on the right
function WarnMark({ count, fallback }: { count: number; fallback: ReactNode }) {
  if (count === 0) return fallback;
  return (
    <span
      role="img"
      aria-label={m.nav_warnings({ count })}
      title={m.nav_warnings({ count })}
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-warn-soft px-1 text-[10.5px] font-semibold text-warn"
    >
      <TriangleAlert className="size-3" />
      {count}
    </span>
  );
}

export function Sidebar({ onNewTable, onSearch }: { onNewTable?: () => void; onSearch?: () => void }) {
  const { data: meta } = useMeta();
  const agents = useAgents();
  const { warnings, connected } = useEvents();
  const readOnly = isReadOnly();
  const { data: conflicts } = useQuery({ queryKey: ["conflicts"], queryFn: api.conflicts, enabled: !readOnly });
  const conflictCount = conflicts?.conflicts.length ?? 0;
  const viewNames = new Set(meta?.views.map((v) => v.name));
  const [collapsed, toggleGroup] = useCollapsedGroups();
  const tableLinks = (t: TableMeta) => {
    const links = warningLinks({ [t.name]: warnings[t.name] ?? [] }, viewNames);
    const warnOf = (view: string | null) => links.filter((w) => w.view === view).length;
    return (
      <Fragment key={t.name}>
        <Link to="/t/$table" params={{ table: t.name }} className={item} activeProps={active}>
          <WarnMark count={warnOf(null)} fallback={<Table2 className="size-3.5 opacity-70" />} />
          {t.name}
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums max-md:text-[12.5px]">{t.count}</span>
        </Link>
        {meta?.views
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
              <span className="ml-auto text-[11px] text-muted-foreground tabular-nums max-md:text-[12.5px]">
                {v.count}
              </span>
            </Link>
          ))}
      </Fragment>
    );
  };
  return (
    <aside className="flex h-full min-h-0 flex-col border-r bg-panel" aria-label={m.nav_sidebar()}>
      <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5 text-base font-bold tracking-tight">
        <img src="./favicon.svg" alt="" className="size-6" />
        yamlite
        <span className="ml-auto truncate font-mono text-[11px] font-normal text-muted-foreground">{meta?.root}</span>
      </div>
      <button
        type="button"
        className="mx-2.5 mb-2 flex justify-between rounded-md border bg-background px-2 py-1.5 text-[12px] text-muted-foreground max-md:py-2.5 max-md:text-[14px]"
        onClick={() => {
          onSearch?.();
          openCommandMenu();
        }}
      >
        <span>{m.nav_search_placeholder()}</span>
        <kbd className="rounded border px-1 font-mono text-[10px] max-md:hidden">⌘K</kbd>
      </button>
      {agents.length > 0 && (
        <button
          type="button"
          className="mx-2.5 mb-2 flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-[13px] max-md:py-2.5 max-md:text-[14px]"
          onClick={() => {
            if (!onSearch) return agentPanel.toggle();
            onSearch();
            agentPanel.open();
          }}
        >
          <Sparkles className="size-4" />
          {m.nav_ask_ai()}
        </button>
      )}
      <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase max-md:text-[12px]">
        {m.nav_tables()}
      </div>
      <nav className="flex flex-col gap-px overflow-auto">
        {meta &&
          groupTables(meta.tables).map(({ group, tables }) => {
            if (group === null) return <Fragment key="">{tables.map(tableLinks)}</Fragment>;
            const open = !collapsed.has(group);
            return (
              <div key={`g:${group}`} role="group" aria-label={group} className="flex flex-col gap-px">
                <button
                  type="button"
                  aria-expanded={open}
                  className="mx-1.5 mt-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-semibold text-muted-foreground hover:bg-panel-2 max-md:py-2 max-md:text-[13px]"
                  onClick={() => toggleGroup(group)}
                >
                  <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
                  <span className="truncate">{group}</span>
                </button>
                {open && tables.map(tableLinks)}
              </div>
            );
          })}
        {!readOnly && (
          <button
            type="button"
            disabled={!connected}
            title={connected ? undefined : m.common_disconnected_hint()}
            className={cn(item, "text-muted-foreground disabled:opacity-50")}
            onClick={onNewTable}
          >
            <Plus className="size-3.5" /> {m.nav_new_table()}
          </button>
        )}
      </nav>
      {meta && meta.pages.length > 0 && (
        <>
          <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase max-md:text-[12px]">
            {m.nav_pages()}
          </div>
          <nav className="flex flex-col gap-px">
            {meta.pages.map((p) => (
              <Link key={p.name} to="/p/$page" params={{ page: p.name }} className={item} activeProps={active}>
                <LayoutDashboard className="size-3.5 opacity-70" />
                <span className="truncate">{p.title}</span>
              </Link>
            ))}
          </nav>
        </>
      )}
      <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase max-md:text-[12px]">
        {m.nav_tools()}
      </div>
      <nav className="flex flex-col gap-px">
        <Link to="/sql" className={item} activeProps={active}>
          <Terminal className="size-3.5 opacity-70" /> {m.nav_sql_console()}
        </Link>
        <Link to="/erd" className={item} activeProps={active}>
          <Network className="size-3.5 opacity-70" /> {m.nav_erd()}
        </Link>
        {!readOnly && (
          <Link to="/sync" className={item} activeProps={active}>
            <ArrowLeftRight className="size-3.5 opacity-70" /> {m.nav_sync()}
            {conflictCount > 0 && (
              <span className="ml-auto rounded-full bg-err-soft px-1.5 text-[10.5px] font-semibold text-err">
                {conflictCount}
              </span>
            )}
          </Link>
        )}
      </nav>
      <div className="mt-auto border-t px-3.5 py-2.5 text-[11px] text-muted-foreground max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))] max-md:text-[12px]">
        {meta?.configFile} · {m.nav_footer_tables({ count: meta?.tables.length ?? 0 })}
        <br />
        {m.nav_footer_db({ db: meta?.db ?? "" })}
        <span className="md:hidden">
          <br />
          {location.host}
        </span>
      </div>
    </aside>
  );
}
