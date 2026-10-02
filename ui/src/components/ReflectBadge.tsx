import { useReflect } from "@/lib/providers";

export function ReflectBadge({ table, recordKey }: { table: string; recordKey: string }) {
  const r = useReflect(table, recordKey);
  if (!r) return null;
  const text =
    r.state === "pending"
      ? "反映中…"
      : r.state === "applied"
        ? `${r.file} に反映済み`
        : r.state === "failed"
          ? `⚠ 反映されませんでした: ${r.reason}`
          : "反映待ち";
  const tone = r.state === "applied" ? "text-ok" : r.state === "failed" ? "text-err" : "text-muted-foreground";
  return (
    <span role="status" className={`text-[11px] ${tone}`}>
      {text}
    </span>
  );
}
