import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { ArrowLeft, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { buildPatch, changedFields } from "@/lib/form";
import { cn } from "@/lib/utils";
import { useDrawerWidth } from "@/lib/drawerWidth";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { isReadOnly } from "@/lib/mode";
import { useIsMobile } from "@/lib/useIsMobile";
import { useViewportHeight } from "@/lib/viewportHeight";
import { useEvents, useReflectDispatch } from "@/lib/providers";
import { historyCount, restoreDraft, useRecordHistory } from "@/lib/recordHistory";
import type { AllowedValue, Bound, ColumnFormat, ColumnType, RecordDetail, Row, TableMeta } from "@/lib/types";
import { FormField } from "./FormField";
import { RecordHistory } from "./RecordHistory";
import { ReflectBadge } from "./ReflectBadge";
import { StaleDialog } from "./StaleDialog";
import { m } from "@/paraglide/messages.js";

// a field named like a prototype member ("constructor") has no declared type unless the table has that column
const columnType = (table: TableMeta, field: string): ColumnType | undefined =>
  Object.hasOwn(table.columns, field) ? table.columns[field] : undefined;
const columnFormat = (table: TableMeta, field: string): ColumnFormat | undefined =>
  Object.hasOwn(table.formats, field) ? table.formats[field] : undefined;
const isMdx = (table: TableMeta) => table.files?.endsWith(".mdx") ?? false;
const columnValues = (table: TableMeta, field: string): AllowedValue[] | undefined =>
  Object.hasOwn(table.values, field) ? table.values[field] : undefined;
const columnBound = (bounds: Record<string, Bound>, field: string): Bound | undefined =>
  Object.hasOwn(bounds, field) ? bounds[field] : undefined;

// laid over the table, so opening a record does not reflow the page under it; a phone gives it the whole screen
const panel =
  "absolute inset-y-0 right-0 z-20 border-l bg-background shadow-xl max-md:fixed max-md:inset-0 max-md:z-40 max-md:h-dvh max-md:border-l-0 max-md:shadow-none max-md:animate-[y-slide-up_160ms_ease-out]";
const tabTrigger = "max-md:flex-1 max-md:text-[14px]";

const isDark = () => document.documentElement.dataset.theme === "dark";

export function RecordDrawer({
  table,
  recordKey,
  headerActions,
  onClose,
}: {
  table: TableMeta;
  recordKey: string;
  headerActions?: ReactNode;
  onClose?: () => void;
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
  // the short sha the form was filled from, until it is saved or discarded
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  const history = useRecordHistory(table.name, recordKey, tab === "history" && !isReadOnly());
  // bumped when the form is reloaded from outside, so every field remounts with fresh state
  const [version, setVersion] = useState(0);
  const dirty = base !== null && draft !== null && changedFields(base, draft).length > 0;
  const [width, setWidth] = useDrawerWidth();
  const mobile = useIsMobile();
  const viewportHeight = useViewportHeight(mobile);
  const size = mobile ? (viewportHeight ? { height: viewportHeight } : undefined) : { width };

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
    setRestoredFrom(null);
  }

  function restore(record: Row, sha: string) {
    if (!base) return;
    setDraft(restoreDraft(base, record, table.key));
    setInvalid(new Set());
    setVersion((v) => v + 1);
    setRestoredFrom(sha.slice(0, 7));
    setTab("form");
  }

  const save = useMutation({
    mutationFn: ({ values, base: b }: { values: Row; base: Row }) => api.update(table.name, recordKey, values, b),
    // tracked before the request: the watcher can write the file before the response arrives
    onMutate: () => dispatch({ type: "saved", table: table.name, key: recordKey, at: Date.now() }),
    onSuccess: (_r, vars) => {
      const next = { ...base, ...vars.values };
      setBase(next);
      setDraft(next);
      setRestoredFrom(null);
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
      if (onClose) onClose();
      else void navigate({ to: "/t/$table", params: { table: table.name }, search: {} });
    },
  });

  const submit = () => {
    if (!base || !draft || !dirty || invalid.size > 0 || !connected || save.isPending) return;
    save.mutate(buildPatch(base, draft));
  };

  const close = () =>
    onClose
      ? onClose()
      : void navigate({ to: "/t/$table", params: { table: table.name }, search: (p) => ({ ...p, key: undefined }) });

  // Escape or a click elsewhere closes the drawer, unless that would throw away unsaved edits
  useEffect(() => {
    if (dirty) return;
    // dialogs, menus and toasts render in portals outside the drawer, and a row opens its own record
    const keep = (target: EventTarget | null) =>
      !(target instanceof Element) ||
      target.closest(
        'aside[data-record-drawer], [role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], [data-sonner-toaster], [role="row"][data-key]',
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
      <aside data-record-drawer aria-label={m.record_label()} className={cn(panel, "p-4 text-err")} style={size}>
        {error.message}
      </aside>
    );
  }
  if (!draft || !base || !data)
    return <aside data-record-drawer aria-label={m.record_label()} className={panel} style={size} />;

  const fields = Object.keys(table.columns).filter((c) => c !== table.key);
  const extra = Object.keys(draft).filter((c) => c !== table.key && !fields.includes(c));
  const changed = new Set(changedFields(base, draft));
  const changes = changed.size;
  const count = historyCount(history.data?.pages);

  return (
    <aside data-record-drawer aria-label={m.record_label()} className={cn(panel, "flex flex-col")} style={size}>
      {!mobile && <PanelResizeHandle width={width} label={m.record_resize()} onResize={setWidth} />}
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-4 py-3 max-md:gap-1 max-md:px-2 max-md:pt-[calc(0.5rem+env(safe-area-inset-top))] max-md:pb-2">
          {mobile && (
            <button
              type="button"
              aria-label={m.common_close_lower()}
              onClick={close}
              className="grid size-10 place-items-center"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          {/* a narrow panel moves the tabs to their own line rather than cut the key down to one letter */}
          <span className="min-w-[6rem] flex-1 truncate font-mono font-bold">{recordKey}</span>
          {headerActions}
          <TabsList className="ml-auto h-7 max-md:order-last max-md:ml-0 max-md:h-9 max-md:w-full">
            <TabsTrigger value="form" className={tabTrigger}>
              {m.record_tab_form()}
            </TabsTrigger>
            <TabsTrigger value="json" className={tabTrigger}>
              JSON
            </TabsTrigger>
            <TabsTrigger value="yaml" className={tabTrigger}>
              {m.record_tab_file()}
            </TabsTrigger>
            {!isReadOnly() && (
              <TabsTrigger value="history" className={tabTrigger}>
                {m.record_tab_history()}
                {count !== null && <span className="ml-1 font-mono text-[10px] text-muted-foreground">{count}</span>}
              </TabsTrigger>
            )}
          </TabsList>
          {!mobile && (
            <button type="button" aria-label={m.common_close_lower()} onClick={close} className="text-muted-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="truncate px-4 pt-3 font-mono text-[11px] text-muted-foreground max-md:text-[12px]">
          {data.file}
        </div>
        <TabsContent
          value="form"
          className="min-h-0 flex-1 overflow-auto px-4 py-3"
          // the on-screen keyboard covers the lower half; keep the field being typed into above it
          onFocus={(e) =>
            mobile &&
            e.target.matches("input, textarea, [contenteditable]") &&
            e.target.scrollIntoView?.({ block: "center" })
          }
        >
          {!connected && <p className="mb-2 text-[11.5px] text-err">{m.record_disconnected()}</p>}
          <fieldset disabled={!editable} className="m-0 min-w-0 border-0 p-0">
            {[...fields, ...extra].map((f) => {
              const reference = table.references.find((r) => r.column === f);
              return (
                <div
                  key={f}
                  className={cn("mb-3.5", restoredFrom && changed.has(f) && "-mx-2 rounded-md bg-warn-soft px-2 py-1")}
                >
                  <div className="mb-1 flex justify-between text-[11.5px] font-semibold text-muted-foreground max-md:text-[13px]">
                    <span className={table.required.includes(f) && draft[f] == null ? "text-warn" : undefined}>
                      {f}
                      {table.required.includes(f) && <span aria-label={m.record_required()}> *</span>}
                    </span>
                    <span className="font-mono text-[10px] font-medium max-md:text-[11.5px]">
                      {reference
                        ? `→ ${reference.table}`
                        : (columnFormat(table, f) ?? columnType(table, f) ?? m.record_new_column())}
                    </span>
                  </div>
                  <FormField
                    key={`${f}:${version}`}
                    readOnly={!editable}
                    path={[f]}
                    value={draft[f]}
                    type={columnType(table, f)}
                    format={columnFormat(table, f)}
                    mdx={isMdx(table)}
                    allowed={columnValues(table, f)}
                    min={columnBound(table.min, f)}
                    max={columnBound(table.max, f)}
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
            aria-label={m.record_json()}
            value={JSON.stringify(draft, null, 2)}
            extensions={[json(), EditorView.lineWrapping]}
            theme={isDark() ? "dark" : "light"}
            editable={editable}
            onChange={(text) => {
              try {
                const parsed: unknown = JSON.parse(text);
                if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
                  throw new Error(m.record_json_not_object());
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
            aria-label={m.record_file()}
            value={data.yaml ?? "# not written to a file yet"}
            extensions={[yaml(), EditorView.lineWrapping]}
            editable={false}
            theme={isDark() ? "dark" : "light"}
          />
        </TabsContent>
        {!isReadOnly() && (
          <TabsContent value="history" className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <RecordHistory
              table={table.name}
              recordKey={recordKey}
              query={history}
              current={base}
              keyColumn={table.key}
              canRestore={editable}
              onRestore={restore}
            />
          </TabsContent>
        )}
      </Tabs>
      {!isReadOnly() && (
        <div className="flex items-center gap-2 border-t px-4 py-2.5 max-md:flex-wrap max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
          <span className="mr-auto flex min-w-0 flex-col text-[11px] text-muted-foreground max-md:basis-full max-md:text-[12px]">
            {changes > 0 ? (
              restoredFrom ? (
                m.record_restored({ from: restoredFrom, count: changes })
              ) : (
                m.record_changes({ count: changes })
              )
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
            aria-label={m.record_delete()}
            disabled={!connected}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" />
          </Button>
          <Button variant="outline" size={mobile ? "lg" : "sm"} disabled={!dirty} onClick={() => reset(base)}>
            {m.record_discard()}
          </Button>
          <Button
            size={mobile ? "lg" : "sm"}
            className="max-md:flex-1"
            disabled={!dirty || invalid.size > 0 || save.isPending || !connected}
            title={connected ? undefined : m.common_disconnected_hint()}
            onClick={submit}
          >
            {mobile ? m.common_save() : m.record_save_shortcut()}
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
              <DialogTitle>{m.record_delete_title({ key: recordKey })}</DialogTitle>
            </DialogHeader>
            <p className="text-[12px] text-muted-foreground">{m.record_delete_note({ file: data.file })}</p>
            {remove.error && <p className="text-[12px] text-err">{remove.error.message}</p>}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmDelete(false);
                  remove.reset();
                }}
              >
                {m.common_cancel()}
              </Button>
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {m.common_delete()}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </aside>
  );
}
