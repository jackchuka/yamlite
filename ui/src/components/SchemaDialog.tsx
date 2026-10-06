import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { Bound, ViewMeta } from "@/lib/types";
import { m } from "@/paraglide/messages.js";

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase max-md:text-[12px]">
        {title}
      </h3>
      {children}
    </section>
  );
}

const cell = "border-b px-2 py-1.5 text-left align-top";
const Empty = () => <p className="text-[12px] text-muted-foreground">{m.schema_none()}</p>;

function ViewSchema({ view }: { view: ViewMeta }) {
  return (
    <div className="flex flex-col gap-5 text-[12.5px]">
      <Section title={m.schema_view()}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{m.schema_parent()}</dt>
          <dd className="font-mono">{view.parent}</dd>
          <dt className="text-muted-foreground">{m.schema_identity()}</dt>
          <dd className="font-mono">{view.identity.length > 0 ? view.identity.join(", ") : "—"}</dd>
          <dt className="text-muted-foreground">{m.schema_db()}</dt>
          <dd>{view.inDb ? m.schema_view_in_db() : m.schema_not_yet()}</dd>
        </dl>
      </Section>
      <Section title={m.schema_columns()}>
        <div className="overflow-x-auto">
          <table className="w-full">
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
      </Section>
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
  const { data, error } = useQuery({
    queryKey: ["schema", table],
    queryFn: () => api.schema(table),
    enabled: open && !view,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-auto sm:max-w-2xl md:max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{m.schema_title({ table })}</DialogTitle>
          <DialogDescription>{view ? m.schema_view_description() : m.schema_table_description()}</DialogDescription>
          {path && <p className="font-mono text-[12px] break-all text-muted-foreground md:hidden">{path}</p>}
        </DialogHeader>
        {view ? (
          <ViewSchema view={view} />
        ) : (
          <>
            {error && <p className="text-[12px] text-err">{error.message}</p>}
            {data && (
              <div className="flex flex-col gap-5 text-[12.5px]">
                <Section title={m.schema_table()}>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">{m.schema_path()}</dt>
                    <dd className="font-mono">{data.mode === "files" ? data.files : data.path}</dd>
                    <dt className="text-muted-foreground">{m.schema_key()}</dt>
                    <dd className="font-mono">{data.key}</dd>
                    <dt className="text-muted-foreground">{m.schema_db()}</dt>
                    <dd>{data.inDb ? m.schema_table_in_db() : m.schema_not_yet()}</dd>
                  </dl>
                </Section>
                <Section title={m.schema_columns()}>
                  <div className="overflow-x-auto">
                    <table className="w-full">
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
                </Section>
                <Section title={m.schema_references()}>
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
                </Section>
                <Section title={m.schema_indexes()}>
                  {data.indexes.length === 0 && data.otherIndexes.length === 0 ? (
                    <Empty />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
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
                </Section>
                <Section title={m.schema_expanded_views()}>
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
                </Section>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
