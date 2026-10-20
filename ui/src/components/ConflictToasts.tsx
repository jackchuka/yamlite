import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { useAppMode } from "@/lib/appMode";
import { useEventStore } from "@/lib/providers";
import { m } from "@/paraglide/messages.js";

export function ConflictToasts() {
  const store = useEventStore();
  const navigate = useNavigate();
  const app = useAppMode();
  useEffect(
    () =>
      store.listen((e) => {
        if (e.type !== "conflict") return;
        toast.warning(m.conflict_title({ table: e.table, key: e.key }), {
          description: e.winner === "file" ? m.conflict_file_won() : m.conflict_db_won(),
          // the diff lives on the sync screen, which an app keeps out of reach
          action: app ? undefined : { label: m.conflict_view_diff(), onClick: () => void navigate({ to: "/sync" }) },
          duration: 15_000,
        });
      }),
    [store, navigate, app],
  );
  return null;
}
