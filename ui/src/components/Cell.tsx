import { Check } from "lucide-react";
import { cellView } from "@/lib/cell";
import type { ColumnType } from "@/lib/types";
import { JsonPopover } from "./JsonPopover";

export const chip = "inline-block rounded-full bg-chip px-[7px] text-[11.5px] text-chip-foreground mr-[3px]";

export function Cell({
  value,
  type,
  column,
  rowKey,
}: {
  value: unknown;
  type: ColumnType;
  column: string;
  rowKey: string;
}) {
  const v = cellView(value, type);
  switch (v.kind) {
    case "null":
      return <span className="text-muted-foreground">—</span>;
    case "bool":
      return (
        <span
          role="img"
          aria-label={v.value ? "true" : "false"}
          className={`inline-flex size-3.5 items-center justify-center rounded-[3px] border-[1.5px] ${v.value ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"}`}
        >
          {v.value && <Check className="size-2.5" strokeWidth={4} />}
        </span>
      );
    case "number":
      return <span className="font-mono tabular-nums">{v.text}</span>;
    case "text":
      return <span>{v.text}</span>;
    case "chips":
      return (
        <span>
          {v.items.map((item, i) => (
            <span key={`${i}-${item}`} className={chip}>
              {item}
            </span>
          ))}
          {v.more > 0 && <span className={chip}>+{v.more}</span>}
        </span>
      );
    case "map":
      return (
        <JsonPopover title={`${column} · ${rowKey}`} value={value}>
          <button type="button" className="text-left" onClick={(e) => e.stopPropagation()}>
            {v.entries.map(([k, text]) => (
              <span key={k} className="mr-1.5">
                <span className="mr-0.5 text-[11px] text-muted-foreground">{k}</span>
                {text}
              </span>
            ))}
            {v.more > 0 && <span className="text-muted-foreground">+{v.more}</span>}
          </button>
        </JsonPopover>
      );
    case "nested":
      return (
        <JsonPopover title={`${column} · ${rowKey}`} value={value}>
          <button type="button" className="text-left" onClick={(e) => e.stopPropagation()}>
            <span className="mr-1.5 rounded border px-1 font-mono text-[10px] text-muted-foreground">{v.label}</span>
            <span className="border-b border-dotted border-muted-foreground">{v.preview}</span>
          </button>
        </JsonPopover>
      );
  }
}
