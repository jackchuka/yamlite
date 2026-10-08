import type { ReactNode } from "react";
import { isLongText } from "@/lib/textdiff";
import { useIsMobile } from "@/lib/useIsMobile";
import { cn } from "@/lib/utils";
import { TextDiff } from "./TextDiff";

export interface DiffRow {
  field: string;
  a: unknown;
  b: unknown;
  dim?: boolean;
}

const asText = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
// side by side, a long text is unreadable: its line breaks collapse and the second column runs off
const isTextChange = (r: DiffRow) => !r.dim && r.a !== r.b && (isLongText(r.a) || isLongText(r.b));

function Columns({
  labels,
  rows,
  note,
  className,
}: {
  labels: [ReactNode, ReactNode];
  rows: { field: string; a: string; b: string; dim?: boolean }[];
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
                <span className={cn(r.dim && "line-clamp-2")}>{value}</span>
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
          <span className={cn("[overflow-wrap:anywhere]", r.dim && "line-clamp-2")}>{r.a}</span>
          <span className={cn("[overflow-wrap:anywhere]", r.dim && "line-clamp-2")}>{r.b}</span>
        </div>
      ))}
    </div>
  );
}

// two versions of a record: short values side by side (stacked on a phone), changed long text as a line diff
export function FieldDiff({
  labels,
  rows,
  format,
  note,
  className,
}: {
  labels: [ReactNode, ReactNode];
  rows: DiffRow[];
  format: (v: unknown) => string;
  note?: ReactNode;
  className?: string;
}) {
  const columns = rows.filter((r) => !isTextChange(r));
  const texts = rows.filter(isTextChange);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {(columns.length > 0 || note) && (
        <Columns
          labels={labels}
          note={note}
          className={className}
          rows={columns.map((r) => ({ field: r.field, a: format(r.a), b: format(r.b), dim: r.dim }))}
        />
      )}
      {texts.map((r) => (
        <TextDiff key={r.field} field={r.field} legend={labels} before={asText(r.a)} after={asText(r.b)} />
      ))}
    </div>
  );
}
