import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isEmbedded } from "@/lib/embedded";
import { staticSnapshot } from "@/lib/mode";
import { useEvents, useMeta } from "@/lib/providers";
import { formatAgo } from "@/lib/format";
import { applyTheme, nextChoice, readChoice, type ThemeChoice } from "@/lib/theme";
import { m } from "@/paraglide/messages.js";
import { LanguageSelect } from "./LanguageSelect";

const THEME_NAME: Record<ThemeChoice, () => string> = {
  light: m.theme_light,
  dark: m.theme_dark,
  system: m.theme_system,
};

export function StatusBar() {
  const { connected, lastSyncAt, warnings } = useEvents();
  const { data: meta } = useMeta();
  const snapshot = staticSnapshot();
  const { data: conflicts } = useQuery({ queryKey: ["conflicts"], queryFn: api.conflicts, enabled: snapshot === null });
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
    <footer className="flex h-[30px] items-center gap-4 border-t bg-panel px-3 text-[11px] text-muted-foreground max-md:h-[calc(40px+env(safe-area-inset-bottom))] max-md:gap-3 max-md:pb-[env(safe-area-inset-bottom)] max-md:text-[12px]">
      {snapshot ? (
        <span>{m.status_snapshot({ at: snapshot.generatedAt.slice(0, 16).replace("T", " ") })}</span>
      ) : (
        <>
          <span className="flex items-center gap-1.5" aria-live="polite">
            <span className={`size-[7px] rounded-full ${connected ? "bg-ok" : "bg-err"}`} />
            {connected ? (
              isEmbedded() ? (
                m.status_connected()
              ) : (
                <>
                  <span className="max-md:hidden">{m.status_watching({ root: meta?.root ?? "" })}</span>
                  <span className="md:hidden">{m.status_connected()}</span>
                </>
              )
            ) : (
              m.status_disconnected()
            )}
          </span>
          <span className="max-md:hidden">{m.status_last_sync({ ago: formatAgo(lastSyncAt, now) })}</span>
          {!isEmbedded() && <span className="max-md:hidden">{location.host}</span>}
        </>
      )}
      <span className="ml-auto flex items-center gap-3.5">
        {warningCount > 0 &&
          (snapshot ? (
            <span className="text-warn">{m.status_warnings({ count: warningCount })}</span>
          ) : (
            <Link to="/sync" className="text-warn hover:underline">
              {m.status_warnings({ count: warningCount })}
            </Link>
          ))}
        {conflictCount > 0 && <span className="text-err">{m.status_conflicts({ count: conflictCount })}</span>}
        <LanguageSelect />
        <button
          type="button"
          aria-label={m.status_theme({ theme: THEME_NAME[theme]() })}
          className="rounded p-1 hover:bg-panel-2 max-md:grid max-md:size-10 max-md:place-items-center"
          onClick={() => {
            const next = nextChoice(theme);
            applyTheme(next);
            setTheme(next);
          }}
        >
          <ThemeIcon className="size-3.5 max-md:size-4.5" />
        </button>
      </span>
    </footer>
  );
}
