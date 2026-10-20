import { useEffect, useRef } from "react";
import { appFooter } from "@/lib/appMode";
import { SendForReview } from "./SendForReview";

// an app's one bar, at the bottom: the host's part on the left (where the data shown comes from) and the edits with
// Send for review on the right. It takes no room while neither has anything in it
export function AppFooter() {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = appFooter();
    if (!host || !slot.current) return;
    slot.current.append(host);
    return () => host.remove();
  }, []);
  return (
    <footer className="app-footer flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-2 border-t bg-panel px-3 py-2 max-md:pb-[calc(8px+env(safe-area-inset-bottom))]">
      <div ref={slot} className="app-footer-host min-w-0 flex-1" />
      <SendForReview />
    </footer>
  );
}
