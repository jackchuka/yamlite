import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// a hint a tap can open: it sits inside rows and links, so the tap stops here
export function HintPopover({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className="contents"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={typeof hint === "string" ? hint : undefined}
            className={cn("shrink-0", className)}
          >
            {children}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto max-w-[min(20rem,calc(100vw-2rem))] text-[13px] whitespace-pre-line">
          {hint}
        </PopoverContent>
      </Popover>
    </span>
  );
}
