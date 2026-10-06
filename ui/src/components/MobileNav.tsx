import { useRouterState } from "@tanstack/react-router";
import { Menu, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { agentPanel, useAgents } from "@/lib/agent";
import { openCommandMenu } from "@/lib/commandMenu";
import { useMeta } from "@/lib/providers";
import { screenTitle } from "@/lib/screen";
import { Sidebar } from "./Sidebar";
import { m } from "@/paraglide/messages.js";

const button = "grid size-10 shrink-0 place-items-center rounded-md hover:bg-panel-2";

export function MobileNav({ onNewTable }: { onNewTable: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: meta } = useMeta();
  const agents = useAgents();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex items-center gap-1 border-b bg-background px-2 pt-[env(safe-area-inset-top)]">
      <button type="button" aria-label={m.nav_menu()} className={button} onClick={() => setOpen(true)}>
        <Menu className="size-5" />
      </button>
      <h1 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{screenTitle(pathname, meta?.pages ?? [])}</h1>
      <button type="button" aria-label={m.nav_search()} className={button} onClick={openCommandMenu}>
        <Search className="size-5" />
      </button>
      {agents.length > 0 && (
        <button type="button" aria-label={m.nav_ask_ai()} className={button} onClick={agentPanel.open}>
          <Sparkles className="size-5" />
        </button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          title={m.nav_menu()}
          // any link closes the sheet, the screen already open included, whose URL does not change
          onClick={(e) => e.target instanceof Element && e.target.closest("a") && setOpen(false)}
        >
          <Sidebar
            onSearch={() => setOpen(false)}
            onNewTable={() => {
              setOpen(false);
              onNewTable();
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
