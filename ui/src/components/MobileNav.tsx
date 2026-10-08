import { useRouterState } from "@tanstack/react-router";
import { ArrowUp, Menu, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { agentPanel, useAgents } from "@/lib/agent";
import { openCommandMenu } from "@/lib/commandMenu";
import { useGit } from "@/lib/git";
import { useMeta } from "@/lib/providers";
import { screenTitle } from "@/lib/screen";
import { ReviewDialog } from "./ReviewDialog";
import { Sidebar } from "./Sidebar";
import { m } from "@/paraglide/messages.js";

const button = "grid size-10 shrink-0 place-items-center rounded-md hover:bg-panel-2";

export function MobileNav({ onNewTable }: { onNewTable: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: meta } = useMeta();
  const agents = useAgents();
  const git = useGit();
  const [review, setReview] = useState(false);
  const changes = git?.branch ? git.changes.length : 0;
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
      {git && changes > 0 && (
        <button
          type="button"
          aria-label={`${m.git_send_review()} (${m.git_changes({ count: changes })})`}
          className={`${button} relative`}
          onClick={() => setReview(true)}
        >
          <ArrowUp className="size-5" />
          <span className="absolute top-1 right-1 min-w-4 rounded-full bg-tomato px-1 text-[10.5px] leading-4 font-semibold text-[var(--y-on-accent)]">
            {changes}
          </span>
        </button>
      )}
      {git && review && <ReviewDialog git={git} open={review} onOpenChange={setReview} />}
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
