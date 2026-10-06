import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Columns3, Database } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { previewFor, usePendingProposals } from "@/lib/agent";
import { api } from "@/lib/api";
import { useGridPrefs } from "@/lib/gridPrefs";
import { SearchTerm } from "@/lib/highlight";
import { warningLinks, warningsByKey } from "@/lib/activity";
import { useEvents, useMeta } from "@/lib/providers";
import type { Filter, Row, TableMeta, ViewMeta } from "@/lib/types";
import { tableRoute } from "@/routes";
import { FilterBar } from "./FilterBar";
import { Grid, type GridColumn } from "./Grid";
import { SchemaDialog } from "./SchemaDialog";
import { TableWarnings } from "./TableWarnings";
import { m } from "@/paraglide/messages.js";

const PAGE = 100;

function hiddenColumns(table: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`yamlite-hidden:${table}`) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveHidden(table: string, hidden: Set<string>): void {
  try {
    localStorage.setItem(`yamlite-hidden:${table}`, JSON.stringify([...hidden]));
  } catch {
    // per-viewer convenience only
  }
}

export function TableView({
  drawer,
  headerActions,
}: {
  drawer?: (t: TableMeta, key: string) => ReactNode;
  headerActions?: (t: TableMeta) => ReactNode;
}) {
  const { table } = tableRoute.useParams();
  const search = tableRoute.useSearch();
  const navigate = useNavigate({ from: tableRoute.fullPath });
  const goTo = useNavigate();
  const { data: meta } = useMeta();
  const { warnings } = useEvents();
  const t = meta?.tables.find((x) => x.name === table);
  const view: ViewMeta | undefined = t ? undefined : meta?.views.find((x) => x.name === table);
  const filters = search.filter ?? [];
  const [hidden, setHidden] = useState(() => hiddenColumns(table));
  const [schemaOpen, setSchemaOpen] = useState(false);
  const gridPrefs = useGridPrefs(table);

  const query = useInfiniteQuery({
    queryKey: view
      ? ["rows", view.table, view.name, { sort: search.sort, filters, search: search.q }]
      : ["rows", table, { sort: search.sort, filters, search: search.q }],
    queryFn: ({ pageParam }) =>
      api.rows(table, { limit: PAGE, offset: pageParam, sort: search.sort, filters, search: search.q }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    enabled: t !== undefined || view !== undefined,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const proposals = usePendingProposals();
  const tableName = t?.name;
  const preview = useMemo(() => (tableName ? previewFor(proposals, tableName) : undefined), [proposals, tableName]);
  const shown = useMemo(() => {
    if (!preview) return rows;
    const inserts = [...preview.values()].filter((p) => p.op === "insert" && p.after).map((p) => p.after as Row);
    return inserts.length > 0 ? [...inserts, ...rows] : rows;
  }, [preview, rows]);
  const total = query.data?.pages[0]?.total ?? 0;
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const setSearch = useCallback(
    (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) }),
    [navigate],
  );
  const onFilters = useCallback(
    (next: { filters: Filter[]; search?: string }) =>
      setSearch({ filter: next.filters.length > 0 ? next.filters : undefined, q: next.search }),
    [setSearch],
  );

  if (!t && !view) return null;
  const all = t ? t.columns : (view as ViewMeta).columns;
  const keyCol = t ? t.key : (view?.identity[0] ?? "");
  const pinned = t ? [t.key] : (view?.identity ?? []);
  const columns: GridColumn[] = Object.entries(all)
    .filter(([name]) => pinned.includes(name) || !hidden.has(name))
    // the key column comes first, where it can stay in place while the rest scrolls
    .sort(([a], [b]) => Number(b === keyCol) - Number(a === keyCol))
    .map(([name, type]) => {
      const reference = (t ?? (view as ViewMeta)).references.find((r) => r.column === name);
      return { name, type, note: reference ? `→ ${reference.table}` : undefined, reference };
    });
  const rowId = view ? (row: Row) => view.identity.map((c) => String(row[c])).join("/") : undefined;
  const onSelect = view
    ? (_key: string, row: Row) =>
        void goTo({ to: "/t/$table", params: { table: view.table }, search: { key: String(row[keyCol]) } })
    : (key: string) => setSearch({ key });
  // a view's warnings come with its table's sync, prefixed by the view's name
  const source = t ? t.name : (view as ViewMeta).table;
  const links = warningLinks({ [source]: warnings[source] ?? [] }, new Set(meta?.views.map((v) => v.name)));
  const ownWarnings = links.filter((w) => w.view === (view ? view.name : null));
  const onOpenRecord = (key: string) =>
    void goTo({ to: "/t/$table", params: { table: view ? view.table : table }, search: { key } });
  const onSort = (column: string) => {
    const [col, dir] = (search.sort ?? "").split(":");
    const next = col !== column ? `${column}:asc` : dir === "asc" ? `${column}:desc` : undefined;
    setSearch({ sort: next });
  };

  const path = t ? (t.mode === "files" ? t.files : t.path) : `from ${view?.parent}`;

  return (
    <div className="relative flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5 border-b px-[18px] py-3 max-md:gap-2 max-md:px-3 max-md:py-2">
          {/* a long name or path gives way, so the buttons stay in view */}
          <h1 title={table} className="min-w-0 truncate text-lg font-semibold tracking-tight max-md:sr-only">
            {table}
          </h1>
          {t ? (
            <span className="min-w-0 shrink-[100] truncate rounded bg-panel px-1.5 font-mono text-[11px] text-muted-foreground max-md:hidden">
              {t.mode === "files" ? t.files : t.path}
            </span>
          ) : (
            <>
              <span className="min-w-0 shrink-[100] truncate rounded bg-panel px-1.5 font-mono text-[11px] text-muted-foreground max-md:hidden">
                {m.table_from({ parent: view?.parent ?? "" })}
              </span>
              <span className="shrink-0 rounded border px-1.5 text-[11px] whitespace-nowrap text-muted-foreground">
                {m.table_read_only_view()}
              </span>
            </>
          )}
          <span className="shrink-0 text-[12px] whitespace-nowrap text-muted-foreground">
            {t ? m.table_records({ count: total }) : m.table_rows({ count: total })}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2.5 max-md:ml-0 max-md:w-full max-md:shrink max-md:overflow-x-auto max-md:pb-0.5">
            <TableWarnings items={ownWarnings} onOpenRecord={onOpenRecord} />
            <Button variant="outline" size="sm" onClick={() => setSchemaOpen(true)}>
              <Database className="size-3.5" /> {m.table_schema()}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns3 className="size-3.5" /> {m.table_columns()}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {Object.keys(all)
                  .filter((c) => !pinned.includes(c))
                  .map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c}
                      checked={!hidden.has(c)}
                      onCheckedChange={(on) => {
                        const next = new Set(hidden);
                        if (on) next.delete(c);
                        else next.add(c);
                        setHidden(next);
                        saveHidden(table, next);
                      }}
                    >
                      {c}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {t && headerActions?.(t)}
          </div>
        </div>
        <FilterBar columns={all} filters={filters} search={search.q} onChange={onFilters} />
        {query.isError && (
          <div role="alert" className="border-b px-[18px] py-2 text-err">
            {query.error.message}
          </div>
        )}
        {(!query.isError || rows.length > 0) && (
          <SearchTerm.Provider value={search.q?.trim() ?? ""}>
            <Grid
              columns={columns}
              rows={shown}
              preview={preview}
              keyCol={keyCol}
              rowId={rowId}
              selectedKey={t ? search.key : undefined}
              onSelect={onSelect}
              onEndReached={onEndReached}
              flagged={t ? warningsByKey(links) : undefined}
              sort={search.sort}
              onSort={onSort}
              widths={gridPrefs.widths}
              onResize={gridPrefs.setWidth}
              pinned={!gridPrefs.unpinned}
              onTogglePin={gridPrefs.togglePin}
            />
          </SearchTerm.Provider>
        )}
      </section>
      {t && search.key !== undefined && drawer?.(t, search.key)}
      {schemaOpen && <SchemaDialog table={table} view={view} path={path} open onOpenChange={setSchemaOpen} />}
    </div>
  );
}
