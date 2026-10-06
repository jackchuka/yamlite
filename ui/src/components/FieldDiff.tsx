import type { ReactNode } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { cn } from "@/lib/utils";

export interface DiffRow {
  field: string;
  a: string;
  b: string;
  dim?: boolean;
}

// two versions of a record side by side; a phone has no room for three columns, so each field stacks its two values
export function FieldDiff({
  labels,
  rows,
  note,
  className,
}: {
  labels: [ReactNode, ReactNode];
  rows: DiffRow[];
  note?: ReactNode;
  className?: string;
}) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <div data-testid="field-diff" className={cn("flex flex-col gap-2 font-mono text-[13px]", className)}>
        {note && <p className="font-sans text-muted-foreground">{note}</p>}
        {rows.map((r) => (
          <div
            key={r.field}
            role="group"
            aria-label={r.field}
            className={cn("overflow-hidden rounded-md border", r.dim && "opacity-50")}
          >
            <div className="bg-panel px-2.5 py-1.5 font-semibold text-syn-key">{r.field}</div>
            {(
              [
                [labels[0], r.a],
                [labels[1], r.b],
              ] as const
            ).map(([label, value], i) => (
              <div key={i} className="flex gap-2 border-t px-2.5 py-1.5 break-all">
                <span className="w-24 shrink-0 font-sans text-[12px] text-muted-foreground">{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      data-testid="field-diff"
      className={cn("grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 font-mono text-[12px]", className)}
    >
      <span />
      <span className="font-sans text-muted-foreground">{labels[0]}</span>
      <span className="font-sans text-muted-foreground">{labels[1]}</span>
      {note && <span className="col-span-3 text-muted-foreground">{note}</span>}
      {rows.map((r) => (
        <div key={r.field} className={cn("contents", r.dim && "opacity-50")}>
          <span className="text-syn-key">{r.field}</span>
          <span>{r.a}</span>
          <span>{r.b}</span>
        </div>
      ))}
    </div>
  );
}
