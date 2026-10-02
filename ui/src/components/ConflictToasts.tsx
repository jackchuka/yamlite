import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { useEventStore } from "@/lib/providers";

export function ConflictToasts() {
  const store = useEventStore();
  const navigate = useNavigate();
  useEffect(
    () =>
      store.listen((e) => {
        if (e.type !== "conflict") return;
        const [won, lost] = e.winner === "file" ? ["ファイル", "DB"] : ["DB", "ファイル"];
        toast.warning(`Conflict in ${e.table}/${e.key}`, {
          description: `ファイルと DB の両方が変更されました。${won}側を採用し、${lost}側の内容をバックアップしました。`,
          action: { label: "差分を見る", onClick: () => void navigate({ to: "/sync" }) },
          duration: 10_000,
        });
      }),
    [store, navigate],
  );
  return null;
}
