import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useRef } from "react";
import { cellView } from "@/lib/cell";
import type { ColumnType, Reference, Row } from "@/lib/types";
import { useIsMobile } from "@/lib/useIsMobile";
import { cn } from "@/lib/utils";
import { Cell, chip } from "./Cell";
import { HintPopover } from "./HintPopover";
import { RefLink } from "./RefLink";

export interface GridColumn {
  name: string;
  type: ColumnType;
  // "→ projects" for reference columns
  note?: string;
  reference?: Reference;
}

function GridCell({ column, row, rowKey }: { column: GridColumn; row: Row; rowKey: string }) {
  const value = row[column.name];
  const v = cellView(value, column.type);
  const { reference } = column;
  if (reference && (v.kind === "text" || v.kind === "number"))
    return <RefLink reference={reference} value={String(value)} />;
  if (reference && v.kind === "chips") {
    return (
      <span>
        {v.items.map((item, i) => (
          <RefLink key={`${i}-${item}`} reference={reference} value={item} className={`${chip} hover:underline`} />
        ))}
        {v.more > 0 && <span className={chip}>+{v.more}</span>}
      </span>
    );
  }
  return <Cell value={value} type={column.type} column={column.name} rowKey={rowKey} />;
}

const ROW_HEIGHT = 34;
const MOBILE_ROW_HEIGHT = 44;
// the key column stays put while the rest scrolls sideways
const pin = "sticky left-0 z-[1] bg-background shadow-[1px_0_0_var(--border)]";

export function Grid({
  columns,
  rows,
  keyCol,
  stickyCol = keyCol,
  rowId,
  selectedKey,
  onSelect,
  onEndReached,
  flagged,
  sort,
  onSort,
}: {
  columns: GridColumn[];
  rows: Row[];
  keyCol: string;
  stickyCol?: string;
  rowId?: (row: Row) => string;
  selectedKey?: string;
  onSelect?: (key: string, row: Row) => void;
  onEndReached?: () => void;
  // each flagged row's warning messages, by row key
  flagged?: Map<string, string[]>;
  sort?: string;
  onSort?: (column: string) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();
  const rowHeight = mobile ? MOBILE_ROW_HEIGHT : ROW_HEIGHT;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });
  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer]);
  const items = virtualizer.getVirtualItems();
  const last = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (rows.length > 0 && last >= rows.length - 20) onEndReached?.();
  }, [last, rows.length, onEndReached]);
  const [keyWidth, colWidth] = mobile
    ? ["minmax(120px, 160px)", "minmax(96px, 1fr)"]
    : ["minmax(160px, 220px)", "minmax(110px, 1fr)"];
  const template = columns.map((c) => (c.name === keyCol ? keyWidth : colWidth)).join(" ");
  const [sortCol, sortDir] = (sort ?? "").split(":");
  return (
    <div
      ref={parent}
      role="grid"
      aria-rowcount={rows.length}
      className="min-h-0 flex-1 overflow-auto text-[12.5px] max-md:text-[14px]"
    >
      {/* as wide as the columns need, so row borders and backgrounds span the whole scrolled width */}
      <div className="w-max min-w-full">
        <div
          role="row"
          className="sticky top-0 z-10 grid border-b bg-background"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((c) => (
            <button
              key={c.name}
              type="button"
              role="columnheader"
              className={cn(
                "flex items-center gap-1 px-3 py-[7px] text-left text-[11.5px] font-semibold whitespace-nowrap text-muted-foreground max-md:text-[12.5px]",
                c.name === stickyCol && pin,
              )}
              onClick={() => onSort?.(c.name)}
            >
              {c.name}
              <span className="rounded bg-panel-2 px-1 font-mono text-[9.5px] font-medium max-md:text-[11px]">
                {c.name === keyCol ? "key" : (c.note ?? c.type)}
              </span>
              {sortCol === c.name &&
                (sortDir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
            </button>
          ))}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((item) => {
            const row = rows[item.index] as Row;
            const key = rowId ? rowId(row) : String(row[keyCol]);
            const selected = key === selectedKey;
            return (
              <div
                key={key}
                role="row"
                aria-selected={selected}
                data-key={key}
                className={cn(
                  "group absolute inset-x-0 grid cursor-pointer border-b md:hover:bg-panel",
                  selected && "bg-tomato-soft md:hover:bg-tomato-soft",
                )}
                style={{ gridTemplateColumns: template, height: rowHeight, transform: `translateY(${item.start}px)` }}
                onClick={() => onSelect?.(key, row)}
              >
                {columns.map((c) => (
                  <div
                    key={c.name}
                    role="gridcell"
                    className={cn(
                      "flex items-center overflow-hidden px-3 whitespace-nowrap",
                      c.name === keyCol && "font-mono text-[12px] max-md:text-[13px]",
                      c.name === stickyCol && pin,
                      c.name === stickyCol && (selected ? "bg-tomato-soft" : "md:group-hover:bg-panel"),
                    )}
                  >
                    {c.name === keyCol &&
                      (flagged?.has(key) ? (
                        <HintPopover
                          label="has warnings"
                          hint={flagged.get(key)?.join("\n")}
                          className="mr-1.5 grid min-h-6 min-w-[1em] place-items-center text-warn max-md:-my-2 max-md:-ml-2 max-md:mr-0 max-md:min-h-8 max-md:min-w-8"
                        >
                          ⚠
                        </HintPopover>
                      ) : (
                        <span aria-hidden className="mr-1.5 w-[1em] shrink-0" />
                      ))}
                    <span className="truncate">
                      <GridCell column={c} row={row} rowKey={key} />
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
