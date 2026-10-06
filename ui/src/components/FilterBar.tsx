import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ColumnType, Filter, FilterOp } from "@/lib/types";

const OPS: Array<[FilterOp, string]> = [
  ["eq", "="],
  ["ne", "≠"],
  ["lt", "<"],
  ["lte", "≤"],
  ["gt", ">"],
  ["gte", "≥"],
  ["contains", "contains"],
  ["has", "has"],
  ["null", "is empty"],
  ["notnull", "is set"],
];
const label = (f: Filter) =>
  `${f.col} ${OPS.find(([op]) => op === f.op)?.[1] ?? f.op}${f.value === undefined ? "" : ` ${JSON.stringify(f.value)}`}`;

export function parseFilterValue(text: string, type: ColumnType): unknown {
  if (type === "BOOLEAN") return text === "true";
  if ((type === "INTEGER" || type === "REAL") && text.trim() !== "" && !Number.isNaN(Number(text))) {
    return type === "INTEGER" && !Number.isSafeInteger(Number(text)) ? text : Number(text);
  }
  return text;
}

export function FilterBar({
  columns,
  filters,
  search,
  onChange,
}: {
  columns: Record<string, ColumnType>;
  filters: Filter[];
  search?: string;
  onChange: (next: { filters: Filter[]; search?: string }) => void;
}) {
  const names = Object.keys(columns);
  const [draft, setDraft] = useState<{ col: string; op: FilterOp; text: string }>({
    col: names[0] ?? "",
    op: "eq",
    text: "",
  });
  const [searchText, setSearchText] = useState(search ?? "");
  const [open, setOpen] = useState(false);
  useEffect(() => setSearchText(search ?? ""), [search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search ?? "") !== searchText) onChange({ filters, search: searchText || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [searchText, search, filters, onChange]);
  const add = () => {
    const needsValue = draft.op !== "null" && draft.op !== "notnull";
    const value = needsValue
      ? parseFilterValue(draft.text, (Object.hasOwn(columns, draft.col) ? columns[draft.col] : undefined) ?? "TEXT")
      : undefined;
    onChange({ filters: [...filters, { col: draft.col, op: draft.op, ...(needsValue ? { value } : {}) }], search });
    setOpen(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-[18px] py-2 max-md:px-3">
      <div className="relative w-full max-w-[280px] max-md:max-w-none max-md:basis-full">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="search"
          placeholder="search all columns…"
          className="h-7 pl-7 text-[12px] max-md:h-9"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setSearchText("")}
        />
      </div>
      {filters.map((f, i) => (
        <button
          key={`${i}-${label(f)}`}
          type="button"
          className="rounded-full border border-tomato bg-tomato-soft px-2 py-0.5 text-[11.5px] text-tomato max-md:min-h-8 max-md:px-3 max-md:text-[13px]"
          onClick={() => onChange({ filters: filters.filter((_, j) => j !== i), search })}
        >
          {label(f)} ×
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded-full border border-dashed px-2 py-0.5 text-[11.5px] text-muted-foreground max-md:min-h-8 max-md:px-3 max-md:text-[13px]"
          >
            + filter
          </button>
        </PopoverTrigger>
        <PopoverContent className="flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2">
          <select
            aria-label="column"
            className="rounded border bg-background px-2 py-1 max-md:py-2"
            value={draft.col}
            onChange={(e) => setDraft({ ...draft, col: e.target.value })}
          >
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <select
            aria-label="operator"
            className="rounded border bg-background px-2 py-1 max-md:py-2"
            value={draft.op}
            onChange={(e) => setDraft({ ...draft, op: e.target.value as FilterOp })}
          >
            {OPS.map(([op, text]) => (
              <option key={op} value={op}>
                {text}
              </option>
            ))}
          </select>
          {draft.op !== "null" && draft.op !== "notnull" && (
            <Input
              aria-label="value"
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
          )}
          <Button size="sm" onClick={add}>
            Add
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
