import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMeta } from "@/lib/providers";
import { referenceSearch } from "@/lib/references";
import type { Reference } from "@/lib/types";

export function RefLink({
  reference,
  value,
  className,
  children,
}: {
  reference: Reference;
  value: string;
  className?: string;
  children?: ReactNode;
}) {
  const { data: meta } = useMeta();
  return (
    <Link
      to="/t/$table"
      params={{ table: reference.table }}
      search={referenceSearch(reference, meta?.tables, value)}
      aria-label={`open ${reference.table} ${value}`}
      className={className ?? "text-tomato underline-offset-2 hover:underline"}
      // the link sits inside a clickable row; following it must not also select the row
      onClick={(e) => e.stopPropagation()}
    >
      {children ?? value}
    </Link>
  );
}
