import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import CodeMirror from "@uiw/react-codemirror";
import { Trash2, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { buildPatch, changedFields } from "@/lib/form";
import { cn } from "@/lib/utils";
import { MIN_WIDTH, maxWidth, useDrawerWidth } from "@/lib/drawerWidth";
import { isReadOnly } from "@/lib/mode";
import { useEvents, useReflectDispatch } from "@/lib/providers";
import type { ColumnType, RecordDetail, Row, TableMeta } from "@/lib/types";
import { FormField } from "./FormField";
import { ReflectBadge } from "./ReflectBadge";
import { StaleDialog } from "./StaleDialog";

// a field named like a prototype member ("constructor") has no declared type unless the table has that column
const columnType = (table: TableMeta, field: string): ColumnType | undefined =>
  Object.hasOwn(table.columns, field) ? table.columns[field] : undefined;

// laid over the table, so opening a record does not reflow the page under it
const panel = "absolute inset-y-0 right-0 z-20 border-l bg-background shadow-xl";
const RESIZE_STEP = 16;

const isDark = () => document.documentElement.dataset.theme === "dark";

export function RecordDrawer({
  table,
  recordKey,
  headerActions,
}: {
  table: TableMeta;
  recordKey: string;
  headerActions?: ReactNode;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const dispatch = useReflectDispatch();
  // while the event stream is down, a save could not be followed to its file
  const { connected } = useEvents();
  const editable = connected && !isReadOnly();
  const { data, error } = useQuery({
    queryKey: ["record", table.name, recordKey],
    queryFn: () => api.record(table.name, recordKey),
  });
  const [base, setBase] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Row | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [stale, setStale] = useState<{ fields: string[]; current: Row } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [tab, setTab] = useState("form");
  // bumped when the form is reloaded from outside, so every field remounts with fresh state
  const [version, setVersion] = useState(0);
  const dirty = base !== null && draft !== null && changedFields(base, draft).length > 0;
  const [width, setWidth] = useDrawerWidth();

  // a refetch (the file changed, or our own save came back) replaces the form only when nothing is being edited
  useEffect(() => {
    if (!data || dirty) return;
    if (draft && changedFields(draft, data.row).length === 0) {
      setBase(data.row);
      return;
    }
    reset(data.row);
  }, [data, dirty]);

  function reset(row: Row) {
    setBase(row);
    setDraft(row);
    setInvalid(new Set());
    setJsonError(null);
    setVersion((v) => v + 1);
  }

  const save = useMutation({
    mutationFn: ({ values, base: b }: { values: Row; base: Row }) => api.update(table.name, recordKey, values, b),
    // tracked before the request: the watcher can write the file before the response arrives
    onMutate: () => dispatch({ type: "saved", table: table.name, key: recordKey, at: Date.now() }),
    onSuccess: (_r, vars) => {
      const next = { ...base, ...vars.values };
      setBase(next);
      setDraft(next);
      // the cached row is pre-save; without this the refetch effect would revert the form to it
      client.setQueryData<RecordDetail>(["record", table.name, recordKey], (old) =>
        old ? { ...old, row: next } : old,
      );
      void client.invalidateQueries({ queryKey: ["record", table.name, recordKey] });
    },
    onError: (e) => {
      dispatch({ type: "cancelled", table: table.name, key: recordKey });
      if (e instanceof ApiError && e.status === 409 && Array.isArray(e.body.stale)) {
        setStale({ fields: e.body.stale as string[], current: e.body.current as Row });
      }
    },
  });
  const remove = useMutation({
    mutationFn: () => api.remove(table.name, recordKey),
    onMutate: () => dispatch({ type: "saved", table: table.name, key: recordKey, at: Date.now() }),
    onError: () => dispatch({ type: "cancelled", table: table.name, key: recordKey }),
    onSuccess: () => {
      void navigate({ to: "/t/$table", params: { table: table.name }, search: {} });
    },
  });

  const submit = () => {
    if (!base || !draft || !dirty || invalid.size > 0 || !connected || save.isPending) return;
    save.mutate(buildPatch(base, draft));
  };

  const close = () =>
    void navigate({ to: "/t/$table", params: { table: table.name }, search: (p) => ({ ...p, key: undefined }) });

  // Escape or a click elsewhere closes the drawer, unless that would throw away unsaved edits
  useEffect(() => {
    if (dirty) return;
    // dialogs, menus and toasts render in portals outside the drawer, and a row opens its own record
    const keep = (target: EventTarget | null) =>
      !(target instanceof Element) ||
      target.closest(
        'aside[aria-label="record"], [role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], [data-sonner-toaster], [role="row"][data-key]',
      ) !== null;
    // on click, not pointerdown, so that whatever was clicked acts before the drawer goes away
    const onClick = (e: MouseEvent) => {
      if (!keep(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape belongs to an open dialog, menu or popover first
      const layer = '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]';
      if (e.key === "Escape" && !document.querySelector(layer)) close();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey) && !isReadOnly()) {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (error) {
    return (
      <aside aria-label="record" className={cn(panel, "p-4 text-err")} style={{ width }}>
        {error.message}
      </aside>
    );
  }
  if (!draft || !base || !data) return <aside aria-label="record" className={panel} style={{ width }} />;

  const fields = Object.keys(table.columns).filter((c) => c !== table.key);
  const extra = Object.keys(draft).filter((c) => c !== table.key && !fields.includes(c));
  const changes = changedFields(base, draft).length;

  return (
    <aside aria-label="record" className={cn(panel, "flex flex-col")} style={{ width }}>
      <ResizeHandle width={width} onResize={setWidth} />
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next);
          // the JSON tab's unparsed text is gone once it unmounts, so its error goes too
          setInvalid((p) => new Set([...p].filter((x) => x !== "$json")));
          setJsonError(null);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span className="truncate font-mono font-bold">{recordKey}</span>
          {headerActions}
          <TabsList className="ml-auto h-7">
            <TabsTrigger value="form">Form</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
            <TabsTrigger value="yaml">YAML</TabsTrigger>
          </TabsList>
          <button type="button" aria-label="close" onClick={close} className="text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-4 pt-3 font-mono text-[11px] text-muted-foreground">{data.file}</div>
        <TabsContent value="form" className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {!connected && <p className="mb-2 text-[11.5px] text-err">接続が切れています</p>}
          <fieldset disabled={!editable} className="m-0 min-w-0 border-0 p-0">
            {[...fields, ...extra].map((f) => {
              const reference = table.references.find((r) => r.column === f);
              return (
                <div key={f} className="mb-3.5">
                  <div className="mb-1 flex justify-between text-[11.5px] font-semibold text-muted-foreground">
                    {f}
                    <span className="font-mono text-[10px] font-medium">
                      {reference ? `→ ${reference.table}` : (columnType(table, f) ?? "new")}
                    </span>
                  </div>
                  <FormField
                    key={`${f}:${version}`}
                    readOnly={!editable}
                    path={[f]}
                    value={draft[f]}
                    type={columnType(table, f)}
                    reference={reference}
                    onChange={(next) => setDraft({ ...draft, [f]: next })}
                    onValidity={(p, ok) =>
                      setInvalid((prev) => {
                        const next = new Set(prev);
                        if (ok) next.delete(p);
                        else next.add(p);
                        return next;
                      })
                    }
                  />
                </div>
              );
            })}
          </fieldset>
        </TabsContent>
        <TabsContent value="json" className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <CodeMirror
            aria-label="record JSON"
            value={JSON.stringify(draft, null, 2)}
            extensions={[json()]}
            theme={isDark() ? "dark" : "light"}
            editable={editable}
            onChange={(text) => {
              try {
                const parsed: unknown = JSON.parse(text);
                if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
                  throw new Error("a record must be a JSON object");
                }
                setDraft({ ...(parsed as Row), [table.key]: draft[table.key] });
                setInvalid((p) => new Set([...p].filter((x) => x !== "$json")));
                setJsonError(null);
              } catch (e) {
                setInvalid((p) => new Set([...p, "$json"]));
                setJsonError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
          {jsonError && <p className="mt-1 text-[11px] text-err">{jsonError}</p>}
        </TabsContent>
        <TabsContent value="yaml" className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {data.yamlError && <p className="mb-2 text-[11.5px] text-err">{data.yamlError}</p>}
          <CodeMirror
            aria-label="record YAML"
            value={data.yaml ?? "# not written to a file yet"}
            extensions={[yaml()]}
            editable={false}
            theme={isDark() ? "dark" : "light"}
          />
        </TabsContent>
      </Tabs>
      {!isReadOnly() && (
        <div className="flex items-center gap-2 border-t px-4 py-2.5">
          <span className="mr-auto flex min-w-0 flex-col text-[11px] text-muted-foreground">
            {changes > 0 ? (
              `変更 ${changes} 件 · 保存すると YAML に反映`
            ) : (
              <ReflectBadge table={table.name} recordKey={recordKey} />
            )}
            {save.isError && !(save.error instanceof ApiError && save.error.status === 409) && (
              <span className="text-err">{save.error.message}</span>
            )}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="delete record"
            disabled={!connected}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={!dirty} onClick={() => reset(base)}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={!dirty || invalid.size > 0 || save.isPending || !connected}
            title={connected ? undefined : "disconnected"}
            onClick={submit}
          >
            Save ⌘S
          </Button>
        </div>
      )}
      {stale && (
        <StaleDialog
          stale={stale.fields}
          current={stale.current}
          draft={draft}
          onClose={() => setStale(null)}
          onReload={() => {
            reset(stale.current);
            setStale(null);
          }}
          onOverwrite={() => {
            const patch = buildPatch(base, draft);
            for (const f of stale.fields) patch.base[f] = stale.current[f] ?? null;
            setStale(null);
            save.mutate(patch);
          }}
        />
      )}
      {confirmDelete && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (open) return;
            setConfirmDelete(false);
            remove.reset();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{recordKey} を削除しますか？</DialogTitle>
            </DialogHeader>
            <p className="text-[12px] text-muted-foreground">{data.file} からも削除されます。</p>
            {remove.error && <p className="text-[12px] text-err">{remove.error.message}</p>}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmDelete(false);
                  remove.reset();
                }}
              >
                キャンセル
              </Button>
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                削除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </aside>
  );
}

function ResizeHandle({ width, onResize }: { width: number; onResize: (w: number | null) => void }) {
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const move = (ev: PointerEvent) => onResize(width + startX - ev.clientX);
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      // a drag released outside the panel ends in a click there, which would otherwise close it
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const delta = e.key === "ArrowLeft" ? RESIZE_STEP : e.key === "ArrowRight" ? -RESIZE_STEP : 0;
    if (delta === 0) return;
    e.preventDefault();
    onResize(width + delta);
  };
  return (
    <div
      role="separator"
      aria-label="Resize record panel"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(null)}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize outline-none hover:bg-primary/40 focus-visible:bg-primary/40"
    />
  );
}
