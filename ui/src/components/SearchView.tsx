import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight, Search, Table2 } from "lucide-react";
import { Highlight, Snippet } from "@/components/Snippet";
import { enoughText, groupHits, useSearch } from "@/lib/search";
import { useDebounced } from "@/lib/useDebounced";
import { m } from "@/paraglide/messages.js";
import { searchRoute } from "@/routes";

const PER_TABLE = 20;

export function SearchView() {
  const { q } = searchRoute.useSearch();
  const navigate = useNavigate();
  const [text, setText] = useState(q ?? "");
  // the URL holds the trimmed text, so only an outside change (back, a link) replaces what is being typed
  useEffect(() => setText((current) => (current.trim() === (q ?? "") ? current : (q ?? ""))), [q]);
  const settled = useDebounced(text.trim(), 200);
  useEffect(() => {
    if (settled !== (q ?? "")) void navigate({ to: "/search", search: { q: settled || undefined }, replace: true });
  }, [settled, q, navigate]);

  const needle = (q ?? "").trim();
  const enough = enoughText(needle);
  const { data, isPending, error } = useSearch(needle, PER_TABLE);
  const groups = enough && data ? groupHits(data.hits, needle) : [];

  let body;
  if (!enough) body = <p className="text-muted-foreground">{m.search_hint()}</p>;
  else if (error)
    body = (
      <p role="alert" className="text-destructive">
        {error.message}
      </p>
    );
  else if (isPending) body = <div aria-busy="true" className="h-24 animate-pulse rounded-md bg-panel-2" />;
  else if (groups.length === 0) body = <p className="text-muted-foreground">{m.search_empty()}</p>;
  else {
    const total = groups.reduce((n, g) => n + g.total, 0);
    body = (
      <>
        <p className="text-[15px] text-muted-foreground">
          {`${m.search_hits({ count: total })} · ${m.search_tables({ count: groups.length })}`}
        </p>
        {groups.map((g) => (
          <section key={g.table} aria-label={g.table} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2.5 px-1">
              <Table2 className="size-[18px] text-muted-foreground" aria-hidden />
              <span className="text-[19px] font-semibold">{g.table}</span>
              <span className="rounded-full border px-2.5 text-[13px] text-muted-foreground">
                {m.search_hits({ count: g.total })}
              </span>
              {g.total > g.hits.length && (
                <Link
                  to="/t/$table"
                  params={{ table: g.table }}
                  search={{ q: needle }}
                  className="ml-auto text-[15px] font-medium text-tomato hover:underline"
                >
                  {m.search_show_all({ count: g.total })}
                </Link>
              )}
            </h2>
            <ul className="divide-y overflow-hidden rounded-xl border">
              {g.hits.map((h) => (
                <li key={h.key}>
                  <Link
                    to="/t/$table"
                    params={{ table: g.table }}
                    search={{ key: h.key }}
                    className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 outline-none hover:bg-panel focus-visible:bg-panel"
                  >
                    <span className="flex min-w-0 items-baseline gap-2.5">
                      <span className="truncate text-[17px] font-semibold">
                        <Highlight text={h.label ?? h.key} needle={needle} />
                      </span>
                      {h.label !== null && (
                        <span className="shrink-0 font-mono text-[13px] text-muted-foreground">
                          <Highlight text={h.key} needle={needle} />
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      className="row-span-2 size-[18px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden
                    />
                    {h.value !== h.key && h.value !== h.label && (
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 rounded-md bg-chip px-1.5 font-mono text-xs text-chip-foreground">
                          {h.column}
                        </span>
                        <span className="truncate text-[15px] text-muted-foreground">
                          <Snippet value={h.value} needle={needle} />
                        </span>
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 overflow-auto px-4 py-6 md:px-8">
      <h1 className="sr-only">{m.search_title()}</h1>
      <label className="flex items-center gap-3 rounded-xl border bg-panel px-4 focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-[22px] shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          aria-label={m.search_title()}
          placeholder={m.search_placeholder()}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          className="h-14 w-full bg-transparent text-[19px] outline-none placeholder:text-muted-foreground"
        />
      </label>
      {body}
    </div>
  );
}
