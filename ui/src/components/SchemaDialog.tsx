import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { isReadOnly } from "@/lib/mode";
import { useMeta } from "@/lib/providers";
import { rulesOf } from "@/lib/rules";
import type { Bound, Meta, RuleTarget, TableSchema, ViewMeta } from "@/lib/types";
import { m } from "@/paraglide/messages.js";
import { RuleEditor } from "./RuleEditor";

const rangeText = (min: Bound | undefined, max: Bound | undefined): string | null =>
  min !== undefined && max !== undefined
    ? `${min} – ${max}`
    : min !== undefined
      ? `≥ ${min}`
      : max !== undefined
        ? `≤ ${max}`
        : null;

const ownOf = <T,>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const cell = "border-b px-2 py-1.5 text-left align-top";
// a card's edge closes the last row
const rows = "w-full [&_tr:last-child>td]:border-b-0";
const Empty = () => <p className="text-[12px] text-muted-foreground">{m.schema_none()}</p>;

type Editing = { target: RuleTarget; viewName?: string };

const editingView = (v: ViewMeta): Editing => ({ target: { table: v.table, path: v.path }, viewName: v.name });

function Editor({
  editing,
  meta,
  schema,
  onEdit,
  onDone,
  footer,
}: {
  editing: Editing;
  meta: Meta;
  schema: TableSchema;
  onEdit: (e: Editing) => void;
  onDone: () => void;
  footer: HTMLElement | null;
}) {
  const view = editing.viewName === undefined ? undefined : meta.views.find((v) => v.name === editing.viewName);
  const table = meta.tables.find((t) => t.name === editing.target.table);
  const source = view ?? table;
  if (!source || schema.base === undefined) return null;
  const depth = editing.target.path.length;
  const trail = [
    { label: editing.target.table, onOpen: () => onEdit({ target: { table: editing.target.table, path: [] } }) },
    ...editing.target.path.slice(0, -1).flatMap((field, i) => {
      const up = meta.views.find(
        (v) =>
          v.table === editing.target.table &&
          v.path.length === i + 1 &&
          v.path.every((p, j) => editing.target.path[j] === p),
      );
      return up ? [{ label: field, onOpen: () => onEdit(editingView(up)) }] : [];
    }),
  ];
  const views = meta.views.filter(
    (v) =>
      v.table === editing.target.table && v.path.length > depth && editing.target.path.every((p, i) => v.path[i] === p),
  );
  return (
    <RuleEditor
      key={`${editing.target.table}/${editing.target.path.join(".")}`}
      target={editing.target}
      viewName={editing.viewName}
      columns={view ? view.columns : schema.columns}
      fixed={view ? view.identity : [schema.key]}
      initial={rulesOf(source)}
      base={schema.base}
      indexes={view ? undefined : schema.indexes}
      views={views.map((v) => ({ name: v.name, path: v.path }))}
      trail={depth > 0 ? trail : undefined}
      here={editing.target.path.at(-1)}
      onOpenView={(name) => {
        const next = meta.views.find((v) => v.name === name);
        if (next) onEdit(editingView(next));
      }}
      onDone={onDone}
      footer={footer}
    />
  );
}

function ViewSchema({ view, editor }: { view: ViewMeta; editor: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 text-[12.5px]">
      <SectionCard title={m.schema_view()}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{m.schema_parent()}</dt>
          <dd className="font-mono">{view.parent}</dd>
          <dt className="text-muted-foreground">{m.schema_identity()}</dt>
          <dd className="font-mono">{view.identity.length > 0 ? view.identity.join(", ") : "—"}</dd>
          <dt className="text-muted-foreground">{m.schema_db()}</dt>
          <dd>{view.inDb ? m.schema_view_in_db() : m.schema_not_yet()}</dd>
        </dl>
      </SectionCard>
      {editor ?? (
        <SectionCard title={m.schema_columns()}>
          <div className="-mx-2 overflow-x-auto">
            <table className={rows}>
              <tbody>
                {Object.entries(view.columns).map(([name, type]) => (
                  <tr key={name}>
                    <td className={`${cell} font-mono`}>{name}</td>
                    <td className={`${cell} font-mono text-muted-foreground`}>{type}</td>
                    <td className={`${cell} text-muted-foreground`}>
                      {view.identity.includes(name)
                        ? m.schema_identity()
                        : [
                            Object.hasOwn(view.declared, name) ? m.schema_declared() : m.schema_inferred(),
                            ...(view.required.includes(name) ? [m.schema_required()] : []),
                            ...(ownOf(view.formats, name) ? [ownOf(view.formats, name) as string] : []),
                            ...(() => {
                              const range = rangeText(ownOf(view.min, name), ownOf(view.max, name));
                              return range ? [range] : [];
                            })(),
                          ].join(" · ")}
                    </td>
                    <td className={`${cell} font-mono text-muted-foreground`}>
                      {Object.hasOwn(view.values, name) ? view.values[name]?.map(String).join(", ") : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

export function SchemaDialog({
  table,
  view,
  path,
  open,
  onOpenChange,
}: {
  table: string;
  view?: ViewMeta;
  // where the table lives; the table header hides it on a phone, so it shows here
  path?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const { data: meta } = useMeta();
  // a view's rules are saved against its table's yamlite.yaml base
  const owner = view?.table ?? table;
  const { data, error } = useQuery({
    queryKey: ["schema", owner],
    queryFn: () => api.schema(owner),
    enabled: open && (!view || editing !== null),
  });
  // a view's dialog shows the table once its editor goes back to the table
  const asView = view !== undefined && (editing === null || editing.viewName !== undefined);
  const canEdit =
    !isReadOnly() && meta !== undefined && !meta.configError && (view !== undefined || data !== undefined);
  const editor =
    editing && meta && data ? (
      <Editor
        editing={editing}
        meta={meta}
        schema={data}
        onEdit={setEditing}
        onDone={() => setEditing(null)}
        footer={footer}
      />
    ) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent pinned className={editing ? "sm:max-w-4xl" : "sm:max-w-2xl"}>
        <DialogHeader pinned>
          <div className="flex items-center gap-2 max-sm:justify-center">
            <DialogTitle>{m.schema_title({ table })}</DialogTitle>
            {editing && (
              <Badge variant="outline" className="border-tomato text-[12px] text-tomato">
                {m.schema_editing()}
              </Badge>
            )}
          </div>
          <DialogDescription>
            {editing ? m.schema_edit_description() : view ? m.schema_view_description() : m.schema_table_description()}
          </DialogDescription>
          {/* the TABLE section shows the path while a table is edited */}
          {path && !(editing && !asView) && (
            <p className="font-mono text-[12px] break-all text-muted-foreground md:hidden">{path}</p>
          )}
          {canEdit && !editing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setEditing(view ? editingView(view) : { target: { table, path: [] } })}
            >
              {m.rules_edit()}
            </Button>
          )}
        </DialogHeader>
        <DialogBody>
          {asView ? (
            <ViewSchema
              view={view}
              editor={editor ?? (editing && error ? <p className="text-[12px] text-err">{error.message}</p> : null)}
            />
          ) : (
            <>
              {error && <p className="text-[12px] text-err">{error.message}</p>}
              {data && (
                <div className="flex flex-col gap-4 text-[12.5px]">
                  <SectionCard title={m.schema_table()}>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                      <dt className="text-muted-foreground">{m.schema_path()}</dt>
                      <dd className="font-mono">{data.mode === "files" ? data.files : data.path}</dd>
                      <dt className="text-muted-foreground">{m.schema_key()}</dt>
                      <dd className="font-mono">{data.key}</dd>
                      <dt className="text-muted-foreground">{m.schema_db()}</dt>
                      <dd>{data.inDb ? m.schema_table_in_db() : m.schema_not_yet()}</dd>
                    </dl>
                  </SectionCard>
                  {editor ?? (
                    <>
                      <SectionCard title={m.schema_columns()}>
                        <div className="-mx-2 overflow-x-auto">
                          <table className={rows}>
                            <tbody>
                              {Object.entries(data.columns).map(([name, type]) => (
                                <tr key={name}>
                                  <td className={`${cell} font-mono`}>{name}</td>
                                  <td className={`${cell} font-mono text-muted-foreground`}>{type}</td>
                                  <td className={`${cell} text-muted-foreground`}>
                                    {name === data.key
                                      ? m.schema_key()
                                      : [
                                          name in data.declared ? m.schema_declared() : m.schema_inferred(),
                                          ...(data.required.includes(name) ? [m.schema_required()] : []),
                                          ...(ownOf(data.formats, name) ? [ownOf(data.formats, name) as string] : []),
                                          ...(() => {
                                            const range = rangeText(ownOf(data.min, name), ownOf(data.max, name));
                                            return range ? [range] : [];
                                          })(),
                                        ].join(" · ")}
                                  </td>
                                  <td className={`${cell} font-mono text-muted-foreground`}>
                                    {Object.hasOwn(data.values, name) ? data.values[name]?.map(String).join(", ") : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </SectionCard>
                      <SectionCard title={m.schema_references()}>
                        {data.references.length === 0 ? (
                          <Empty />
                        ) : (
                          data.references.map((r) => (
                            <div key={r.column} className="rounded-md border px-3 py-2">
                              <div className="flex items-center gap-2 font-mono">
                                <span>{r.column}</span>
                                <span className="text-muted-foreground">→</span>
                                <span>{`${r.table}.${r.target}`}</span>
                                <span
                                  className={`ml-auto font-sans text-[11px] ${r.problems.length > 0 ? "text-warn" : "text-ok"}`}
                                >
                                  {r.problems.length > 0 ? m.schema_broken_refs({ count: r.problems.length }) : "OK"}
                                </span>
                              </div>
                              {r.problems.length > 0 && (
                                <ul className="mt-1.5 list-disc pl-5 text-[11.5px] text-muted-foreground">
                                  {r.problems.map((p) => (
                                    <li key={p}>{p}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))
                        )}
                      </SectionCard>
                    </>
                  )}
                  {!editor && (
                    <>
                      <SectionCard title={m.schema_indexes()}>
                        {data.indexes.length === 0 && data.otherIndexes.length === 0 ? (
                          <Empty />
                        ) : (
                          <div className="-mx-2 overflow-x-auto">
                            <table className={rows}>
                              <tbody>
                                {data.indexes.map((i) => (
                                  <tr key={i.name}>
                                    <td className={`${cell} font-mono`}>{i.definition}</td>
                                    <td className={`${cell} font-mono text-[11px] text-muted-foreground`}>{i.name}</td>
                                    <td className={`${cell} ${i.inDb ? "text-ok" : "text-warn"}`}>
                                      {i.inDb ? m.schema_created() : m.schema_not_created()}
                                    </td>
                                  </tr>
                                ))}
                                {data.otherIndexes.map((name) => (
                                  <tr key={name}>
                                    <td className={`${cell} font-mono`}>{name}</td>
                                    <td className={`${cell} text-[11px] text-muted-foreground`} colSpan={2}>
                                      {m.schema_unmanaged_index()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {data.indexes.some((i) => !i.inDb) && (
                          <p className="text-[11px] text-muted-foreground">{m.schema_not_created_hint()}</p>
                        )}
                      </SectionCard>
                      <SectionCard title={m.schema_expanded_views()}>
                        {data.views.length === 0 ? (
                          <Empty />
                        ) : (
                          data.views.map((v) => (
                            <div
                              key={v.name}
                              className="rounded-md border px-3 py-2"
                              style={{ marginLeft: `${(v.depth - 1) * 16}px` }}
                            >
                              <div className="flex items-center gap-2 font-mono">
                                <a
                                  href={`#/t/${encodeURIComponent(v.name)}`}
                                  className="underline-offset-2 hover:underline"
                                  onClick={() => onOpenChange(false)}
                                >
                                  {v.name}
                                </a>
                                <span className={`ml-auto font-sans text-[11px] ${v.inDb ? "text-ok" : "text-warn"}`}>
                                  {v.inDb ? m.schema_created() : m.schema_not_created()}
                                </span>
                              </div>
                              {v.inDb && (
                                <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">
                                  {Object.keys(v.columns).join(", ")}
                                </p>
                              )}
                              {v.problems.length > 0 && (
                                <ul className="mt-1.5 list-disc pl-5 text-[11.5px] text-muted-foreground">
                                  {v.problems.map((p) => (
                                    <li key={p}>{p}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))
                        )}
                      </SectionCard>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </DialogBody>
        <div ref={setFooter} className="shrink-0 empty:hidden" />
      </DialogContent>
    </Dialog>
  );
}
