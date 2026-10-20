import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { useGit } from "@/lib/git";
import { isReadOnly } from "@/lib/mode";
import { m } from "@/paraglide/messages.js";
import { ReviewDialog } from "./ReviewDialog";

// the app's way to send its edits: shown only once there is something to send. The dialog stays open after a send
// empties the count, so it can show where the changes went
export function SendForReview() {
  const git = useGit();
  const [open, setOpen] = useState(false);
  if (isReadOnly() || !git || (git.changes.length === 0 && !open)) return null;
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      {git.changes.length > 0 && (
        <>
          <span className="text-[13px] text-muted-foreground">{m.git_changes({ count: git.changes.length })}</span>
          <button
            type="button"
            disabled={git.branch === null}
            className="flex items-center gap-1.5 rounded-md bg-tomato px-3 py-1.5 text-[13px] font-semibold text-[var(--y-on-accent)] hover:opacity-90 disabled:opacity-60"
            onClick={() => setOpen(true)}
          >
            <ArrowUp className="size-3.5" />
            {m.git_send_review()}
          </button>
        </>
      )}
      {open && <ReviewDialog git={git} open={open} onOpenChange={setOpen} />}
    </div>
  );
}
