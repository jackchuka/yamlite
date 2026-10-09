import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { useDrawerWidth } from "@/lib/drawerWidth";
import { changedFields, setIn } from "@/lib/form";
import { isReadOnly } from "@/lib/mode";
import { useEvents, useReflectDispatch } from "@/lib/providers";
import { useIsMobile } from "@/lib/useIsMobile";
import { useViewportHeight } from "@/lib/viewportHeight";
import type { RecordDetail, Row, ViewMeta } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FormField } from "./FormField";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { panel, useDismiss } from "./RecordDrawer";
import { ReflectBadge } from "./ReflectBadge";
import { m } from "@/paraglide/messages.js";

const isMap = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);

// the steps from the table's record to the row's element: each expanded field, then the row's position in it
export function elementPath(view: ViewMeta, row: Row): Array<string | number> {
  return view.path.flatMap((field, i) => {
    const position = row[view.identity[i + 1] as string];
    return [field, typeof position === "number" ? position : String(position)];
  });
}

function getIn(value: unknown, path: Array<string | number>): unknown {
  let at = value;
  for (const step of path) {
    if (Array.isArray(at) && typeof step === "number") at = at[step];
    else if (isMap(at) && typeof step === "string" && Object.hasOwn(at, step)) at = at[step];
    else return undefined;
  }
  return at;
}

const own = <T,>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

// a view's row shown where it was clicked; an edit is saved to the element it comes from in the table's record
export function ViewRowDrawer({
  view,
  rowKey,
  row,
  onClose,
  onOpenRecord,
}: {
  view: ViewMeta;
  rowKey: string;
  row: Row | undefined;
  onClose: () => void;
  onOpenRecord: () => void;
}) {
  const client = useQueryClient();
  const dispatch = useReflectDispatch();
  const { connected } = useEvents();
  const [width, setWidth] = useDrawerWidth();
  const mobile = useIsMobile();
  const viewportHeight = useViewportHeight(mobile);
  const size = mobile ? (viewportHeight ? { height: viewportHeight } : undefined) : { width };

  const parentKey = row ? String(row[view.identity[0] as string]) : undefined;
  const { data, error } = useQuery({
    queryKey: ["record", view.table, parentKey],
    queryFn: () => api.record(view.table, parentKey as string),
    enabled: parentKey !== undefined,
  });
  const path = row ? elementPath(view, row) : [];
  const element = data ? getIn(data.row, path) : undefined;
  // a row of scalars holds its element in the value column; a row of maps, one column per field
  const scalar = element !== undefined && !isMap(element);
  const fields = Object.keys(view.columns).filter((c) => !view.identity.includes(c));
  const current: Row | undefined =
    element === undefined
      ? undefined
      : scalar
        ? { value: element }
        : Object.fromEntries(fields.map((f) => [f, own(element as Row, f) ?? null]));

  const [base, setBase] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Row | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0);
  const dirty = base !== null && draft !== null && changedFields(base, draft).length > 0;
  const editable = connected && !isReadOnly() && element !== undefined;

  // a refetch replaces the form only when nothing is being edited
  const currentText = current ? JSON.stringify(current) : undefined;
  useEffect(() => {
    if (!current || dirty) return;
    setBase(current);
    setDraft(current);
    setInvalid(new Set());
    setVersion((v) => v + 1);
  }, [currentText, dirty]);

  const save = useMutation({
    mutationFn: ({ detail, values }: { detail: RecordDetail; values: Row }) => {
      const field = view.path[0] as string;
      const before = getIn(detail.row, path);
      const next = scalar
        ? values.value
        : Object.fromEntries(
            Object.entries({ ...(before as Row), ...values }).filter(([, v]) => v !== null && v !== undefined),
          );
      const updated = setIn(detail.row, path, next) as Row;
      return api.update(view.table, parentKey as string, { [field]: updated[field] }, { [field]: detail.row[field] });
    },
    onMutate: () => dispatch({ type: "saved", table: view.table, key: parentKey as string, at: Date.now() }),
    onSuccess: () => {
      setBase(draft);
      void client.invalidateQueries({ queryKey: ["record", view.table, parentKey] });
    },
    onError: (e) => {
      dispatch({ type: "cancelled", table: view.table, key: parentKey as string });
      if (e instanceof ApiError && e.status === 409)
        void client.invalidateQueries({ queryKey: ["record", view.table, parentKey] });
    },
  });

  const submit = () => {
    if (!data || !base || !draft || !dirty || invalid.size > 0 || !editable || save.isPending) return;
    const values = Object.fromEntries(changedFields(base, draft).map((f) => [f, draft[f] ?? null]));
    save.mutate({ detail: data, values });
  };

  useDismiss(onClose, !dirty);

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

  const shown = scalar ? ["value"] : fields;
  const changes = base && draft ? changedFields(base, draft).length : 0;
  const missing = row === undefined || (data !== undefined && element === undefined);

  return (
    <aside data-record-drawer aria-label={m.view_row_label()} className={cn(panel, "flex flex-col")} style={size}>
      {!mobile && <PanelResizeHandle width={width} label={m.record_resize()} onResize={setWidth} />}
      <div className="flex items-center gap-2 border-b px-4 py-3 max-md:gap-1 max-md:px-2 max-md:pt-[calc(0.5rem+env(safe-area-inset-top))] max-md:pb-2">
        {mobile && (
          <button
            type="button"
            aria-label={m.common_close_lower()}
            onClick={onClose}
            className="grid size-10 place-items-center"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <span className="min-w-0 flex-1 truncate font-mono font-bold">{rowKey}</span>
        <Button variant="ghost" size="sm" disabled={!row} onClick={onOpenRecord}>
          <ArrowUpRight className="size-3.5" /> {m.view_row_open_record({ table: view.table })}
        </Button>
        {!mobile && (
          <button type="button" aria-label={m.common_close_lower()} onClick={onClose} className="text-muted-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="truncate px-4 pt-3 font-mono text-[11px] text-muted-foreground max-md:text-[12px]">
        {data ? `${data.file} › ${path.join(".")}` : m.table_from({ parent: view.parent })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {error && <p className="mb-2 text-[11.5px] text-err">{error.message}</p>}
        {missing && <p className="mb-2 text-[11.5px] text-err">{m.view_row_missing()}</p>}
        {!connected && <p className="mb-2 text-[11.5px] text-err">{m.record_disconnected()}</p>}
        {row && view.identity.length > 0 && (
          <dl className="mb-3.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] max-md:text-[13px]">
            {view.identity.map((c) => (
              <div key={c} className="contents">
                <dt className="font-semibold text-muted-foreground">{c}</dt>
                <dd className="truncate font-mono">{String(row[c] ?? "")}</dd>
              </div>
            ))}
          </dl>
        )}
        {draft && (
          <fieldset disabled={!editable} className="m-0 min-w-0 border-0 p-0">
            {shown.map((f) => {
              const reference = view.references.find((r) => r.column === f);
              const format = own(view.formats, f);
              const type = own(view.columns, f);
              const required = view.required.includes(f);
              return (
                <div key={f} className="mb-3.5">
                  <div className="mb-1 flex justify-between text-[11.5px] font-semibold text-muted-foreground max-md:text-[13px]">
                    <span className={required && draft[f] == null ? "text-warn" : undefined}>
                      {f}
                      {required && <span aria-label={m.record_required()}> *</span>}
                    </span>
                    <span className="font-mono text-[10px] font-medium max-md:text-[11.5px]">
                      {reference ? `→ ${reference.table}` : (format ?? type)}
                    </span>
                  </div>
                  <FormField
                    key={`${f}:${version}`}
                    readOnly={!editable}
                    path={[f]}
                    value={draft[f]}
                    type={type}
                    format={format}
                    allowed={own(view.values, f)}
                    min={own(view.min, f)}
                    max={own(view.max, f)}
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
        )}
      </div>
      {!isReadOnly() && (
        <div className="flex items-center gap-2 border-t px-4 py-2.5 max-md:flex-wrap max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
          <span className="mr-auto flex min-w-0 flex-col text-[11px] text-muted-foreground max-md:basis-full max-md:text-[12px]">
            {changes > 0 ? (
              m.record_changes({ count: changes })
            ) : parentKey !== undefined ? (
              <ReflectBadge table={view.table} recordKey={parentKey} />
            ) : null}
            {save.isError && (
              <span className="text-err">
                {save.error instanceof ApiError && save.error.status === 409 ? m.view_row_stale() : save.error.message}
              </span>
            )}
          </span>
          <Button
            variant="outline"
            size={mobile ? "lg" : "sm"}
            disabled={!dirty}
            onClick={() => {
              if (!base) return;
              setDraft(base);
              setInvalid(new Set());
              setVersion((v) => v + 1);
            }}
          >
            {m.record_discard()}
          </Button>
          <Button
            size={mobile ? "lg" : "sm"}
            className="max-md:flex-1"
            disabled={!dirty || invalid.size > 0 || save.isPending || !editable}
            title={connected ? undefined : m.common_disconnected_hint()}
            onClick={submit}
          >
            {mobile ? m.common_save() : m.record_save_shortcut()}
          </Button>
        </div>
      )}
    </aside>
  );
}
