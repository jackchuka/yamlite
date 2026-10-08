import { type ReactNode, useMemo, useState } from "react";
import { type DiffLine, diffText, type Hunk, hunks } from "@/lib/textdiff";
import { cn } from "@/lib/utils";
import { m } from "@/paraglide/messages.js";

const SIGN = { same: " ", add: "+", del: "-" } as const;

function Line({ line }: { line: DiffLine }) {
  return (
    <div
      className={cn(
        "flex gap-2 px-2.5",
        line.kind === "add" && "bg-ok/15",
        line.kind === "del" && "bg-err-soft",
        line.kind === "same" && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn("shrink-0 select-none", line.kind === "add" ? "text-ok" : line.kind === "del" && "text-err")}
      >
        {SIGN[line.kind]}
      </span>
      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {line.segments.map((s, i) =>
          s.mark ? (
            <mark key={i} className={cn("rounded-sm text-inherit", line.kind === "add" ? "bg-ok/30" : "bg-err/25")}>
              {s.text}
            </mark>
          ) : (
            s.text
          ),
        )}
        {line.segments.every((s) => s.text === "") && " "}
      </span>
    </div>
  );
}

function Skip({ hunk }: { hunk: Hunk }) {
  const [open, setOpen] = useState(false);
  if (open) return hunk.lines.map((l, i) => <Line key={i} line={l} />);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="block w-full bg-panel px-2.5 py-0.5 text-left font-sans text-[13px] text-muted-foreground hover:text-foreground"
    >
      {m.proposal_unchanged_lines({ count: hunk.lines.length })}
    </button>
  );
}

// line-by-line diff of a long text such as a Markdown body, with the changed words marked
export function TextDiff({
  field,
  before,
  after,
  legend,
}: {
  field: string;
  before: string;
  after: string;
  legend: [ReactNode, ReactNode];
}) {
  const parts = useMemo(() => hunks(diffText(before, after)), [before, after]);
  return (
    <div role="group" aria-label={field} className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
        <span className="font-mono text-syn-key">{field}</span>
        <span className="text-muted-foreground">
          <span className="font-mono text-err">{SIGN.del}</span> <span className="[&>*]:text-inherit">{legend[0]}</span>
        </span>
        <span className="text-muted-foreground">
          <span className="font-mono text-ok">{SIGN.add}</span> <span className="[&>*]:text-inherit">{legend[1]}</span>
        </span>
      </div>
      <div className="overflow-hidden rounded-md border font-mono text-[13px] leading-relaxed">
        {parts.map((h, i) =>
          h.kind === "skip" ? <Skip key={i} hunk={h} /> : h.lines.map((l, j) => <Line key={`${i}:${j}`} line={l} />),
        )}
      </div>
    </div>
  );
}
