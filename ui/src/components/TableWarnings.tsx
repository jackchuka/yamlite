import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { WarningLink } from "@/lib/activity";

export function TableWarnings({ items, onOpenRecord }: { items: WarningLink[]; onOpenRecord: (key: string) => void }) {
  if (items.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="text-warn">
          <TriangleAlert className="size-3.5" /> {items.length} 件の警告
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-80 w-[440px] overflow-auto p-0">
        <ul aria-label="warnings" className="text-[12px]">
          {items.map((w, i) => (
            <li key={`${i}-${w.text}`} className="border-b px-3 py-2 last:border-b-0">
              {w.key !== null && (
                <button
                  type="button"
                  className="font-mono font-semibold text-tomato hover:underline"
                  onClick={() => onOpenRecord(w.key as string)}
                >
                  {w.key}
                </button>
              )}
              {w.view !== null && (
                <a
                  href={`#/t/${encodeURIComponent(w.view)}`}
                  className="font-mono font-semibold text-tomato hover:underline"
                >
                  {w.view}
                </a>
              )}
              <p className="text-muted-foreground">{w.text}</p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
