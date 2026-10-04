import { useQuery } from "@tanstack/react-query";
import { type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { isReadOnly } from "@/lib/mode";
import { PageHost } from "@/lib/pages/host";
import { injectPage } from "@/lib/pages/inject";
import { useEventStore, useMeta } from "@/lib/providers";
import type { Meta, PageMeta } from "@/lib/types";
import { accessSummary } from "../../../src/pages/access.ts";
import { RecordDrawer } from "./RecordDrawer";

export function PageView({ name }: { name: string }) {
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
  const srcDoc = useMemo(
    () =>
      network !== undefined && html.data !== undefined
        ? injectPage(html.data, network ? network.split(" ") : [])
        : undefined,
    [network, html.data],
  );
  // the frame is rebuilt only when its document changes, not on every refetch
  const frameKey = `${generation}:${JSON.stringify([page?.access, page?.sql, page?.title])}:${srcDoc}`;
  const current = useRef({ page, meta });
  current.current = { page, meta };
  const ready = page !== undefined && meta !== undefined;

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
        blocked: (url) => setBlocked((list) => (list.includes(url) ? list : [...list, url])),
      },
    );
    window.addEventListener("message", host.handle);
    const off = store.listen((e) => {
      if (e.type === "sync" && (e.changes.length > 0 || e.schema.length > 0)) host.notify([e.table]);
      else if (e.type === "hello" || e.type === "reload") {
        host.notify((current.current.meta?.tables ?? []).map((t) => t.name));
      }
    });
    return () => {
      host.dispose();
      window.removeEventListener("message", host.handle);
      off();
    };
  }, [ready, srcDoc, navigated, store]);

  if (!meta) return null;
  if (!page) return <div className="p-6 text-muted-foreground">ページが見つかりません</div>;
  const table = opened ? meta.tables.find((t) => t.name === opened.table) : undefined;
  // the first load is the srcdoc itself; any later one means the page navigated its frame somewhere else
  const onLoad = (e: SyntheticEvent<HTMLIFrameElement>) => {
    if (counted.current.el !== e.currentTarget) counted.current = { el: e.currentTarget, n: 0 };
    counted.current.n += 1;
    if (counted.current.n > 1) setNavigated(true);
  };
  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b px-[18px] py-2.5">
        <h1 className="text-[15px] font-semibold">{page.title}</h1>
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={page.path}>
          {accessSummary(page)}
        </span>
      </header>
      {blocked.length > 0 && (
        <div role="alert" className="border-b bg-warn-soft px-[18px] py-1.5 text-[12px] text-warn">
          blocked: {blocked.join(", ")}
        </div>
      )}
      {html.isError && (
        <div role="alert" className="px-[18px] py-2 text-err">
          {html.error.message}
        </div>
      )}
      {navigated ? (
        <div role="alert" className="flex items-center gap-3 px-[18px] py-3 text-err">
          ページが別の URL に移動したため、接続を切りました。
          <Button size="sm" onClick={() => setGeneration((g) => g + 1)}>
            再読み込み
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
