import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Layers,
  LayoutDashboard,
  ListFilter,
  Network,
  Plus,
  Sparkles,
  Table2,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { agentPanel, useAgents } from "@/lib/agent";
import { warningLinks } from "@/lib/activity";
import { openCommandMenu } from "@/lib/commandMenu";
import { useGit } from "@/lib/git";
import { groupTables, useCollapsedGroups, useExpandedTables } from "@/lib/groups";
import { api } from "@/lib/api";
import { isReadOnly } from "@/lib/mode";
import { useEvents, useMeta } from "@/lib/providers";
import { isSplitActive, splitFilter } from "@/lib/split";
import type { Filter, TableMeta } from "@/lib/types";
import { cn } from "@/lib/utils";
import { m } from "@/paraglide/messages.js";
import { ReviewDialog } from "./ReviewDialog";

const item =
  "flex items-center gap-2 rounded-md px-2.5 py-1.5 mx-1.5 text-[13px] hover:bg-panel-2 max-md:py-2.5 max-md:text-[15px]";
const active = {
  className: cn(
    item,
    "bg-tomato text-[var(--y-on-accent)] font-semibold hover:bg-tomato [&>[data-count]]:text-current [&>[data-count]]:opacity-80",
  ),
};

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
  const [expanded, toggleExpanded] = useExpandedTables();
  const here = useRouterState({ select: (s) => s.matches.find((x) => x.routeId === "/t/$table") });
  const hereTable = (here?.params as { table?: string } | undefined)?.table;
  const hereFilters = (here?.search as { filter?: Filter[] } | undefined)?.filter ?? [];
  const hereView = meta?.views.find((v) => v.name === hereTable);
  const activeSplitItem = (t: TableMeta) => {
    const split = t.split;
    return split !== null && hereTable === t.name
      ? split.items.find((it) => isSplitActive(hereFilters, split, it))
      : undefined;
  };
  const activeParent = hereView?.table ?? meta?.tables.find((t) => activeSplitItem(t) !== undefined)?.name ?? null;
  // a table opened because one of its items is shown can be folded until that table has none shown
  const [shut, setShut] = useState<string | null>(null);
  if (shut !== null && shut !== activeParent) setShut(null);
  const tableLinks = (t: TableMeta) => {
    const links = warningLinks({ [t.name]: warnings[t.name] ?? [] }, viewNames);
    const warnOf = (view: string | null) => links.filter((w) => w.view === view).length;
    const split = t.split;
    const views = meta?.views.filter((v) => v.table === t.name) ?? [];
    const activeItem = activeSplitItem(t);
    const foldable = (split !== null && split.items.length > 0) || views.length > 0;
    const open = foldable && (expanded.has(t.name) || (activeParent === t.name && shut !== t.name));
    const toggleOpen = () => {
      if (activeParent !== t.name) {
        toggleExpanded(t.name);
        return;
      }
      if (!open) {
        setShut(null);
        return;
      }
      if (expanded.has(t.name)) toggleExpanded(t.name);
      setShut(t.name);
    };
    return (
      <Fragment key={t.name}>
        <div className="flex items-center">
          <Link
            to="/t/$table"
            params={{ table: t.name }}
            className={cn(item, "min-w-0 flex-1")}
            activeProps={activeItem ? {} : { className: cn(active.className, "min-w-0 flex-1") }}
          >
            <WarnMark count={warnOf(null)} fallback={<Table2 className="size-3.5 opacity-70" />} />
            <span className="truncate">{t.name}</span>
            <span data-count className="ml-auto text-[11px] text-muted-foreground tabular-nums max-md:text-[12.5px]">
              {t.count}
            </span>
          </Link>
          {foldable && (
            <button
              type="button"
              aria-label={m.nav_table_toggle({ table: t.name })}
              aria-expanded={open}
              className="mr-1.5 rounded-md p-1 text-muted-foreground hover:bg-panel-2 max-md:p-2"
              onClick={toggleOpen}
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
          )}
        </div>
        {open &&
          split?.items.map((it) => (
            <Link
              key={JSON.stringify(it.value)}
              to="/t/$table"
              params={{ table: t.name }}
              search={{ filter: [splitFilter(split, it)] }}
              className={cn(it === activeItem ? active.className : item, "min-w-0")}
              activeProps={{}}
              style={{ paddingLeft: "24px" }}
            >
              <ListFilter className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">{it.value === null ? m.nav_split_none() : String(it.value)}</span>
              <span data-count className="ml-auto text-[11px] text-muted-foreground tabular-nums max-md:text-[12.5px]">
                {it.count}
              </span>
            </Link>
          ))}
        {open &&
          views.map((v) => (
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
              <span data-count className="ml-auto text-[11px] text-muted-foreground tabular-nums max-md:text-[12.5px]">
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
        <RootInfo />
      </div>
      <div className="mx-2.5 mb-2 flex gap-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 justify-between rounded-md border bg-background px-2 py-1.5 text-[12px] text-muted-foreground max-md:py-2.5 max-md:text-[14px]"
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
            aria-label={m.nav_ask_ai()}
            title={m.nav_ask_ai()}
            className="grid place-items-center rounded-md border bg-background px-2 hover:bg-panel-2 max-md:px-3"
            onClick={() => {
              if (!onSearch) return agentPanel.toggle();
              onSearch();
              agentPanel.open();
            }}
          >
            <Sparkles className="size-4" />
          </button>
        )}
      </div>
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
      {!readOnly && <GitFooter />}
    </aside>
  );
}

function RootInfo() {
  const { data: meta } = useMeta();
  const root = meta?.root ?? "";
  const name = root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={m.nav_root_info()}
          className="ml-auto flex min-w-0 items-center gap-0.5 rounded px-1 font-mono text-[11px] font-normal text-muted-foreground hover:bg-panel-2 max-md:text-[12.5px]"
        >
          <span className="truncate">{name}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-[13px]">
        <div className="font-mono text-[12px] break-all text-muted-foreground">{root}</div>
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{m.nav_root_config()}</dt>
          <dd className="truncate font-mono">{meta?.configFile}</dd>
          <dt className="text-muted-foreground">{m.nav_root_db()}</dt>
          <dd className="truncate font-mono">{meta?.db}</dd>
          <dt className="text-muted-foreground">{m.nav_tables()}</dt>
          <dd>{meta?.tables.length ?? 0}</dd>
          <dt className="text-muted-foreground">{m.nav_root_host()}</dt>
          <dd className="truncate font-mono">{location.host}</dd>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

export function GitFooter() {
  const git = useGit();
  const [open, setOpen] = useState(false);
  if (!git) return null;
  const count = git.changes.length;
  return (
    <div className="mt-auto border-t px-3.5 py-2.5 text-[12px] max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))] max-md:text-[13.5px]">
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <GitBranch className="size-3.5 shrink-0" />
        <span className="truncate font-mono">{git.branch ?? m.git_detached()}</span>
        <span>·</span>
        {count > 0 ? (
          <span className="shrink-0 font-semibold text-foreground">{m.git_changes({ count })}</span>
        ) : (
          <span className="shrink-0">{m.git_no_changes()}</span>
        )}
      </div>
      <button
        type="button"
        disabled={count === 0 || git.branch === null}
        className={cn(
          "mt-2 flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] max-md:py-2.5 max-md:text-[15px]",
          count > 0
            ? "bg-tomato font-semibold text-[var(--y-on-accent)] hover:opacity-90"
            : "border bg-background text-muted-foreground disabled:opacity-60",
        )}
        onClick={() => setOpen(true)}
      >
        <ArrowUp className="size-3.5" />
        {m.git_send_review()}
      </button>
      {open && <ReviewDialog git={git} open={open} onOpenChange={setOpen} />}
    </div>
  );
}
