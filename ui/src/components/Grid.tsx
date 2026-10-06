import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Pin, PinOff } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import type { RowPreview } from "@/lib/agent";
import { cellView } from "@/lib/cell";
import { Highlight } from "@/lib/highlight";
import type { ColumnType, Reference, Row } from "@/lib/types";
import { useIsMobile } from "@/lib/useIsMobile";
import { cn } from "@/lib/utils";
import { Cell, chip } from "./Cell";
import { HintPopover } from "./HintPopover";
import { RefLink } from "./RefLink";
import { m } from "@/paraglide/messages.js";

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
    return (
      <RefLink reference={reference} value={String(value)}>
        <Highlight text={String(value)} />
      </RefLink>
    );
  if (reference && v.kind === "chips") {
    return (
      <span>
        {v.items.map((item, i) => (
          <RefLink key={`${i}-${item}`} reference={reference} value={item} className={`${chip} hover:underline`}>
            <Highlight text={item} />
          </RefLink>
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
const RESIZE_STEP = 16;

function ResizeEdge({
  column,
  width,
  onResize,
}: {
  column: string;
  width?: number;
  onResize: (column: string, width: number | null) => void;
}) {
  const widthOf = (el: HTMLElement) => width ?? el.parentElement?.getBoundingClientRect().width ?? 0;
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    document.body.setAttribute("data-resizing", "");
    const startX = e.clientX;
    const startWidth = widthOf(el);
    const move = (ev: PointerEvent) => onResize(column, startWidth + ev.clientX - startX);
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      el.removeEventListener("lostpointercapture", end);
      document.body.removeAttribute("data-resizing");
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === "ArrowRight" ? RESIZE_STEP : e.key === "ArrowLeft" ? -RESIZE_STEP : 0;
    if (delta === 0) return;
    e.preventDefault();
    onResize(column, widthOf(e.currentTarget) + delta);
  };
  return (
    <div
      role="separator"
      aria-label={m.grid_resize({ column })}
      aria-orientation="vertical"
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(column, null)}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 -right-[3px] z-[2] w-1.5 cursor-col-resize touch-none outline-none hover:bg-primary/40 focus-visible:bg-primary/40"
    />
  );
}

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
  widths,
  onResize,
  pinned = true,
  onTogglePin,
  preview,
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
  // px, for columns the viewer has resized
  widths?: Record<string, number>;
  onResize?: (column: string, width: number | null) => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  // pending AI proposals by row key; nothing is written until they are applied
  preview?: Map<string, RowPreview>;
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
  const template = columns
    .map((c) => {
      const w = widths?.[c.name];
      return w !== undefined ? `${w}px` : c.name === keyCol ? keyWidth : colWidth;
    })
    .join(" ");
  const sticky = pinned ? stickyCol : undefined;
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
            <div
              key={c.name}
              role="columnheader"
              className={cn("group/header relative flex min-w-0 items-center", c.name === sticky && pin)}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 px-3 py-[7px] text-left text-[11.5px] font-semibold whitespace-nowrap text-muted-foreground max-md:text-[12.5px]"
                onClick={() => onSort?.(c.name)}
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 rounded bg-panel-2 px-1 font-mono text-[9.5px] font-medium max-md:text-[11px]">
                  {c.name === keyCol ? m.grid_key() : (c.note ?? c.type)}
                </span>
                {sortCol === c.name &&
                  (sortDir === "desc" ? (
                    <ArrowDown className="size-3 shrink-0" />
                  ) : (
                    <ArrowUp className="size-3 shrink-0" />
                  ))}
              </button>
              {c.name === stickyCol && onTogglePin && (
                <button
                  type="button"
                  aria-label={pinned ? m.grid_unpin_key() : m.grid_pin_key()}
                  aria-pressed={pinned}
                  title={pinned ? m.grid_unpin_key_hint() : m.grid_pin_key_hint()}
                  className={cn(
                    "mr-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-panel-2 hover:text-foreground focus-visible:opacity-100 max-md:size-8",
                    pinned && "opacity-0 group-hover/header:opacity-100 max-md:opacity-100",
                  )}
                  onClick={onTogglePin}
                >
                  {pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
                </button>
              )}
              {onResize && !mobile && <ResizeEdge column={c.name} width={widths?.[c.name]} onResize={onResize} />}
            </div>
          ))}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((item) => {
            const row = rows[item.index] as Row;
            const key = rowId ? rowId(row) : String(row[keyCol]);
            const selected = key === selectedKey;
            const pv = preview?.get(key);
            return (
              <div
                key={key}
                role="row"
                aria-selected={selected}
                data-key={key}
                data-preview={pv?.op}
                className={cn(
                  "group absolute inset-x-0 grid cursor-pointer border-b md:hover:bg-panel",
                  selected && "bg-tomato-soft md:hover:bg-tomato-soft",
                  pv && "bg-warn-soft md:hover:bg-warn-soft",
                  pv?.op === "delete" && "line-through opacity-60",
                  pv?.op === "insert" && "cursor-default",
                )}
                style={{ gridTemplateColumns: template, height: rowHeight, transform: `translateY(${item.start}px)` }}
                onClick={() => pv?.op !== "insert" && onSelect?.(key, row)}
              >
                {columns.map((c) => (
                  <div
                    key={c.name}
                    role="gridcell"
                    className={cn(
                      "flex items-center overflow-hidden px-3 whitespace-nowrap",
                      c.name === keyCol && "font-mono text-[12px] max-md:text-[13px]",
                      c.name === sticky && pin,
                      c.name === sticky && pv && "bg-warn-soft",
                      c.name === sticky && !pv && (selected ? "bg-tomato-soft" : "md:group-hover:bg-panel"),
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
                    {pv?.op === "update" && pv.changed.includes(c.name) ? (
                      <span className="flex min-w-0 items-center gap-1.5 truncate">
                        <span data-testid="preview-old" className="text-muted-foreground line-through">
                          <GridCell column={c} row={pv.before ?? row} rowKey={key} />
                        </span>
                        →
                        <span className="font-semibold text-ok">
                          <GridCell column={c} row={pv.after ?? row} rowKey={key} />
                        </span>
                      </span>
                    ) : (
                      <span className="truncate">
                        <GridCell column={c} row={row} rowKey={key} />
                      </span>
                    )}
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
