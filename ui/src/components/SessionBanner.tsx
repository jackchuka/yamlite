import { useSyncExternalStore } from "react";
import { session } from "@/lib/api";
import { m } from "@/paraglide/messages.js";

export function SessionBanner() {
  const expired = useSyncExternalStore(session.subscribe, session.expired);
  if (!expired) return null;
  return (
    <div role="alert" className="bg-err-soft px-4 py-2 text-[12px] text-err">
      {m.shell_session_expired()}
    </div>
  );
}
