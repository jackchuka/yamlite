import { useReflect } from "@/lib/providers";
import { m } from "@/paraglide/messages.js";

export function ReflectBadge({ table, recordKey }: { table: string; recordKey: string }) {
  const r = useReflect(table, recordKey);
  if (!r) return null;
  const text =
    r.state === "pending"
      ? m.record_reflecting()
      : r.state === "applied"
        ? m.record_reflected({ file: r.file })
        : r.state === "failed"
          ? m.record_reflect_failed({ reason: r.reason })
          : m.record_reflect_waiting();
  const tone = r.state === "applied" ? "text-ok" : r.state === "failed" ? "text-err" : "text-muted-foreground";
  return (
    <span role="status" className={`text-[11px] ${tone}`}>
      {text}
    </span>
  );
}
