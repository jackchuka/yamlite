import { useNavigate } from "@tanstack/react-router";
import { defaultFilter } from "cmdk";
import { ArrowRight, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Highlight, Snippet } from "@/components/Snippet";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { agentPanel, useAgents } from "@/lib/agent";
import { setCommandMenuOpen, useCommandMenuOpen } from "@/lib/commandMenu";
import { isReadOnly } from "@/lib/mode";
import { useMeta } from "@/lib/providers";
import { enoughText, rankHits, useSearch } from "@/lib/search";
import { useDebounced } from "@/lib/useDebounced";
import { m } from "@/paraglide/messages.js";

// record items bypass cmdk's filter: the server already matched them, and equal scores keep its order
const RECORD = "\u0000";
const filter = (value: string, search: string, keywords?: string[]) =>
  value.startsWith(RECORD) ? 1 : defaultFilter(value, search, keywords);
const MENU_HITS = 10;
// the menu is narrow, so the match must sit close to the start of its snippet
const SNIPPET_LEAD = 10;

export function CommandMenu() {
  const open = useCommandMenuOpen();
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const agents = useAgents();
  const [text, setText] = useState("");
  useEffect(() => {
    if (!open) setText("");
  }, [open]);
  const needle = useDebounced(text.trim(), 200);
  const enough = enoughText(needle);
  const { data, isFetching } = useSearch(needle, 5);
  const hits = enough && data ? rankHits(data.hits, needle).slice(0, MENU_HITS) : [];
  const total =
    enough && data ? [...new Map(data.hits.map((h) => [h.table, h.total])).values()].reduce((a, b) => a + b, 0) : 0;
  const showRecords = enough && (hits.length > 0 || isFetching);
  const recordValue = (h: { table: string; key: string }) => `${RECORD}${h.table}${RECORD}${h.key}`;
  // results land after the debounce, when cmdk has already picked an item; put the best record under enter
  const [selected, setSelected] = useState("");
  const best = hits[0] ? recordValue(hits[0]) : null;
  useEffect(() => {
    if (best) setSelected(best);
  }, [best]);
  const allResults = () => go(() => navigate({ to: "/search", search: { q: needle } }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandMenuOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const go = (fn: () => void) => {
    setCommandMenuOpen(false);
    fn();
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={setCommandMenuOpen}
      filter={filter}
      value={selected}
      onValueChange={setSelected}
      className="sm:max-w-2xl"
    >
      <CommandInput
        placeholder={m.cmd_placeholder()}
        className="max-md:pr-10"
        value={text}
        onValueChange={setText}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && hits.length > 0) {
            e.preventDefault();
            allResults();
          }
        }}
      />
      <CommandList className="max-h-[min(480px,60vh)] max-md:max-h-none">
        {!showRecords && <CommandEmpty>{m.cmd_empty()}</CommandEmpty>}
        {showRecords && (
          <CommandGroup
            heading={
              <span className="flex justify-between">
                <span>{m.cmd_records()}</span>
                {total > 0 && <span>{m.search_hits({ count: total })}</span>}
              </span>
            }
            forceMount
          >
            {hits.map((h) => (
              <CommandItem
                key={`${h.table}${RECORD}${h.key}`}
                value={recordValue(h)}
                className="gap-3"
                onSelect={() =>
                  go(() => navigate({ to: "/t/$table", params: { table: h.table }, search: { key: h.key } }))
                }
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-panel text-muted-foreground">
                  <Table2 className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-base font-semibold">
                      <Highlight text={h.label ?? h.key} needle={needle} />
                    </span>
                    {h.label !== null && (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        <Highlight text={h.key} needle={needle} />
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{h.table}</span>
                  </span>
                  {h.value !== h.key && h.value !== h.label && (
                    <span className="truncate text-sm text-muted-foreground">
                      {`${h.column}: `}
                      <Snippet value={h.value} needle={needle} around={SNIPPET_LEAD} />
                    </span>
                  )}
                </span>
              </CommandItem>
            ))}
            {hits.length === 0 && (
              <CommandItem value={`${RECORD}searching`} disabled>
                {m.cmd_searching()}
              </CommandItem>
            )}
            {hits.length > 0 && (
              <CommandItem value={`${RECORD}all`} className="font-semibold text-tomato" onSelect={allResults}>
                {m.cmd_all_results({ count: total })}
                <ArrowRight className="ml-auto size-4" aria-hidden />
              </CommandItem>
            )}
          </CommandGroup>
        )}
        <CommandGroup heading={m.nav_tables()}>
          {meta?.tables.map((t) => (
            <CommandItem
              key={t.name}
              onSelect={() => go(() => navigate({ to: "/t/$table", params: { table: t.name } }))}
            >
              {t.name}
            </CommandItem>
          ))}
        </CommandGroup>
        {meta && meta.views.length > 0 && (
          <CommandGroup heading={m.cmd_views()}>
            {meta.views.map((v) => (
              <CommandItem
                key={v.name}
                onSelect={() => go(() => navigate({ to: "/t/$table", params: { table: v.name } }))}
              >
                {v.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {meta && meta.pages.length > 0 && (
          <CommandGroup heading={m.nav_pages()}>
            {meta.pages.map((p) => (
              <CommandItem
                key={p.name}
                onSelect={() => go(() => navigate({ to: "/p/$page", params: { page: p.name } }))}
              >
                {p.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading={m.nav_tools()}>
          <CommandItem onSelect={() => go(() => navigate({ to: "/sql" }))}>{m.nav_sql_console()}</CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/erd" }))}>{m.nav_erd()}</CommandItem>
          {!isReadOnly() && (
            <CommandItem onSelect={() => go(() => navigate({ to: "/sync" }))}>{m.nav_sync()}</CommandItem>
          )}
          {agents.length > 0 && <CommandItem onSelect={() => go(agentPanel.open)}>{m.nav_ask_ai()}</CommandItem>}
        </CommandGroup>
      </CommandList>
      <div className="flex gap-4 border-t px-3.5 py-2 text-xs text-muted-foreground max-md:hidden">
        {[
          ["↑↓", m.cmd_hint_move()],
          ["↵", m.cmd_hint_open()],
          ["⌘↵", m.cmd_hint_all()],
        ].map(([key, label]) => (
          <span key={key}>
            <kbd className="mr-1 rounded border px-1 font-mono">{key}</kbd>
            {label}
          </span>
        ))}
      </div>
    </CommandDialog>
  );
}
