import { useQuery } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useEvents, useMeta } from "@/lib/providers";
import { applyTheme, nextChoice, readChoice, type ThemeChoice } from "@/lib/theme";

function ago(at: string | null, now: number): string {
  if (!at) return "—";
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

export function StatusBar() {
  const { connected, lastSyncAt, warnings } = useEvents();
  const { data: meta } = useMeta();
  const { data: conflicts } = useQuery({ queryKey: ["conflicts"], queryFn: api.conflicts });
  const [now, setNow] = useState(Date.now());
  const [theme, setTheme] = useState<ThemeChoice>(readChoice);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const warningCount = Object.values(warnings).reduce((n, w) => n + w.length, 0);
  const conflictCount = conflicts?.conflicts.length ?? 0;
  const ThemeIcon = theme === "system" ? Monitor : theme === "light" ? Sun : Moon;
  return (
    <footer className="flex items-center gap-4 border-t bg-panel px-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5" aria-live="polite">
        <span className={`size-[7px] rounded-full ${connected ? "bg-ok" : "bg-err"}`} />
        {connected ? `watching ${meta?.root ?? ""}` : "disconnected"}
      </span>
      <span>last sync {ago(lastSyncAt, now)}</span>
      <span>{location.host}</span>
      <span className="ml-auto flex items-center gap-3.5">
        {warningCount > 0 && <span className="text-warn">⚠ {warningCount} warnings</span>}
        {conflictCount > 0 && <span className="text-err">● {conflictCount} conflicts</span>}
        <button
          type="button"
          aria-label={`theme: ${theme}`}
          className="rounded p-1 hover:bg-panel-2"
          onClick={() => {
            const next = nextChoice(theme);
            applyTheme(next);
            setTheme(next);
          }}
        >
          <ThemeIcon className="size-3.5" />
        </button>
      </span>
    </footer>
  );
}
