import { useSyncExternalStore } from "react";
import { session } from "@/lib/api";

export function SessionBanner() {
  const expired = useSyncExternalStore(session.subscribe, session.expired);
  if (!expired) return null;
  return (
    <div role="alert" className="bg-err-soft px-4 py-2 text-[12px] text-err">
      セッションが切れました。`yamlite serve` が表示した URL を開き直してください。
    </div>
  );
}
