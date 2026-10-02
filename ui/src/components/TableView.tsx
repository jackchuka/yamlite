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
import { api } from "@/lib/api";
import { warnedKeys } from "@/lib/cell";
import { useEvents, useMeta } from "@/lib/providers";
import type { Filter, TableMeta } from "@/lib/types";
import { tableRoute } from "@/routes";
import { FilterBar } from "./FilterBar";
import { Grid, type GridColumn } from "./Grid";
import { SchemaDialog } from "./SchemaDialog";

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
  const { data: meta } = useMeta();
  const { warnings } = useEvents();
  const t = meta?.tables.find((x) => x.name === table);
  const filters = search.filter ?? [];
  const [hidden, setHidden] = useState(() => hiddenColumns(table));
  const [schemaOpen, setSchemaOpen] = useState(false);

  const query = useInfiniteQuery({
    queryKey: ["rows", table, { sort: search.sort, filters, prefix: search.prefix }],
    queryFn: ({ pageParam }) =>
      api.rows(table, { limit: PAGE, offset: pageParam, sort: search.sort, filters, prefix: search.prefix }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    enabled: t !== undefined,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
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
    (next: { filters: Filter[]; prefix?: string }) =>
      setSearch({ filter: next.filters.length > 0 ? next.filters : undefined, prefix: next.prefix }),
    [setSearch],
  );

  if (!t) return null;
  const columns: GridColumn[] = Object.entries(t.columns)
    .filter(([name]) => name === t.key || !hidden.has(name))
    .map(([name, type]) => {
      const ref = t.references.find((r) => r.column === name);
      return { name, type, note: ref ? `→ ${ref.table}` : undefined };
    });
  const onSort = (column: string) => {
    const [col, dir] = (search.sort ?? "").split(":");
    const next = col !== column ? `${column}:asc` : dir === "asc" ? `${column}:desc` : undefined;
    setSearch({ sort: next });
  };

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2.5 border-b px-[18px] py-3">
          <h1 className="text-lg font-semibold tracking-tight">{t.name}</h1>
          <span className="rounded bg-panel px-1.5 font-mono text-[11px] text-muted-foreground">
            {t.mode === "dir" ? `${t.path}/*.yaml` : t.path}
          </span>
          <span className="text-[12px] whitespace-nowrap text-muted-foreground">{total} records</span>
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setSchemaOpen(true)}>
            <Database className="size-3.5" /> Schema
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="size-3.5" /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {Object.keys(t.columns)
                .filter((c) => c !== t.key)
                .map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c}
                    checked={!hidden.has(c)}
                    onCheckedChange={(on) => {
                      const next = new Set(hidden);
                      if (on) next.delete(c);
                      else next.add(c);
                      setHidden(next);
                      saveHidden(t.name, next);
                    }}
                  >
                    {c}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {headerActions?.(t)}
        </div>
        <FilterBar columns={t.columns} filters={filters} prefix={search.prefix} onChange={onFilters} />
        {query.isError && (
          <div role="alert" className="border-b px-[18px] py-2 text-err">
            {query.error.message}
          </div>
        )}
        {(!query.isError || rows.length > 0) && (
          <Grid
            columns={columns}
            rows={rows}
            keyCol={t.key}
            selectedKey={search.key}
            onSelect={(key) => setSearch({ key })}
            onEndReached={onEndReached}
            flagged={warnedKeys(warnings[t.name])}
            sort={search.sort}
            onSort={onSort}
          />
        )}
      </section>
      {search.key !== undefined && drawer?.(t, search.key)}
      {schemaOpen && <SchemaDialog table={t.name} open onOpenChange={setSchemaOpen} />}
    </div>
  );
}
