import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { JsonTree } from "./JsonTree";

export function JsonPopover({ title, value, children }: { title: string; value: unknown; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{title}</span>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => void navigator.clipboard?.writeText(JSON.stringify(value, null, 2))}
          >
            Copy
          </button>
        </div>
        <JsonTree value={value} />
      </PopoverContent>
    </Popover>
  );
}
