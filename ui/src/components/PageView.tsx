import { useQuery } from "@tanstack/react-query";
import { type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { isReadOnly } from "@/lib/mode";
import { PageHost } from "@/lib/pages/host";
import { injectPage } from "@/lib/pages/inject";
import { useEventStore, useMeta } from "@/lib/providers";
import { useTheme } from "@/lib/theme";
import type { Meta, PageMeta } from "@/lib/types";
import { accessBrief, accessSummary } from "../../../src/pages/access.ts";
import { RecordDrawer } from "./RecordDrawer";
import { HintPopover } from "./HintPopover";
import { m } from "@/paraglide/messages.js";

export function PageView({ name }: { name: string }) {
  const theme = useTheme();
  // a new document bakes in the theme of that moment; later switches and hello arrive as messages
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const hostRef = useRef<PageHost | null>(null);
  const { data: meta } = useMeta();
  const store = useEventStore();
  const page = meta?.pages.find((p) => p.name === name);
  const html = useQuery({ queryKey: ["page", name], queryFn: () => api.pageHtml(name), enabled: page !== undefined });
  const frame = useRef<HTMLIFrameElement>(null);
  const counted = useRef<{ el: EventTarget | null; n: number }>({ el: null, n: 0 });
  const [generation, setGeneration] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [opened, setOpened] = useState<{ table: string; key: string } | null>(null);
  const network = page?.network.join(" ");
  // everything but the theme that makes a new frame; the document is rebuilt with it so it bakes in the current theme
  const rebuild = `${generation}:${JSON.stringify([page?.access, page?.sql, page?.title])}`;
  const srcDoc = useMemo(
    () =>
      network !== undefined && html.data !== undefined
        ? injectPage(html.data, network ? network.split(" ") : [], themeRef.current)
        : undefined,
    [network, html.data, rebuild],
  );
  // the frame is rebuilt only when its document changes, not on every refetch
  const frameKey = `${rebuild}:${srcDoc}`;
  const current = useRef({ page, meta });
  current.current = { page, meta };
  const ready = page !== undefined && meta !== undefined;
  const focused = () => frame.current !== null && document.activeElement === frame.current;

  useEffect(() => {
    setNavigated(false);
    setBlocked([]);
  }, [frameKey]);

  useEffect(() => {
    if (!ready || srcDoc === undefined || navigated) return;
    const host = new PageHost(
      () => frame.current?.contentWindow ?? null,
      () => current.current.page as PageMeta,
      () => current.current.meta as Meta,
      {
        api,
        readOnly: isReadOnly(),
        open: (table, key) => setOpened({ table, key }),
        theme: () => themeRef.current,
        // the page may post these at any time; only while the user is in it do they stand for the user's input
        escape: () => {
          if (focused()) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        },
        click: () => {
          if (focused()) frame.current?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        },
        blocked: (url) => setBlocked((list) => (list.includes(url) ? list : [...list, url])),
      },
    );
    hostRef.current = host;
    window.addEventListener("message", host.handle);
    const off = store.listen((e) => {
      if (e.type === "sync" && (e.changes.length > 0 || e.schema.length > 0)) host.notify([e.table]);
      else if (e.type === "hello" || e.type === "reload") {
        host.notify((current.current.meta?.tables ?? []).map((t) => t.name));
      }
    });
    return () => {
      hostRef.current = null;
      host.dispose();
      window.removeEventListener("message", host.handle);
      off();
    };
  }, [ready, srcDoc, navigated, store]);

  useEffect(() => {
    hostRef.current?.theme(theme);
  }, [theme]);

  if (!meta) return null;
  if (!page) return <div className="p-6 text-muted-foreground">{m.page_not_found()}</div>;
  const table = opened ? meta.tables.find((t) => t.name === opened.table) : undefined;
  // the first load is the srcdoc itself; any later one means the page navigated its frame somewhere else
  const onLoad = (e: SyntheticEvent<HTMLIFrameElement>) => {
    if (counted.current.el !== e.currentTarget) counted.current = { el: e.currentTarget, n: 0 };
    counted.current.n += 1;
    if (counted.current.n > 1) setNavigated(true);
  };
  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-[18px] py-2.5 max-md:px-3">
        <h1 className="shrink-0 whitespace-nowrap text-[15px] font-semibold max-md:sr-only">{page.title}</h1>
        <HintPopover
          label={m.page_access()}
          hint={`${page.path}\n${accessSummary(page)}`}
          className="min-w-0 truncate text-left font-mono text-[11px] text-muted-foreground max-md:text-[12px]"
        >
          {accessBrief(page)}
        </HintPopover>
      </header>
      {blocked.length > 0 && (
        <div role="alert" className="border-b bg-warn-soft px-[18px] py-1.5 text-[12px] text-warn">
          {m.page_blocked({ list: blocked.join(", ") })}
        </div>
      )}
      {html.isError && (
        <div role="alert" className="px-[18px] py-2 text-err">
          {html.error.message}
        </div>
      )}
      {navigated ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 px-[18px] py-3 text-err max-md:px-3">
          {m.page_navigated()}
          <Button size="sm" onClick={() => setGeneration((g) => g + 1)}>
            {m.page_reload()}
          </Button>
        </div>
      ) : (
        srcDoc !== undefined && (
          <iframe
            key={frameKey}
            ref={frame}
            title={page.title}
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            onLoad={onLoad}
            className="min-h-0 flex-1 border-0 bg-background"
          />
        )
      )}
      {table && opened && (
        <RecordDrawer
          key={`${table.name}:${opened.key}`}
          table={table}
          recordKey={opened.key}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  );
}
