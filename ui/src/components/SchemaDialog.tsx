import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { ViewMeta } from "@/lib/types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

const cell = "border-b px-2 py-1.5 text-left align-top";
const empty = <p className="text-[12px] text-muted-foreground">なし</p>;

function ViewSchema({ view }: { view: ViewMeta }) {
  return (
    <div className="flex flex-col gap-5 text-[12.5px]">
      <Section title="View">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">parent</dt>
          <dd className="font-mono">{view.parent}</dd>
          <dt className="text-muted-foreground">identity</dt>
          <dd className="font-mono">{view.identity.length > 0 ? view.identity.join(", ") : "—"}</dd>
          <dt className="text-muted-foreground">DB</dt>
          <dd>{view.inDb ? "VIEW あり" : "まだありません"}</dd>
        </dl>
      </Section>
      <Section title="Columns">
        <table className="w-full">
          <tbody>
            {Object.entries(view.columns).map(([name, type]) => (
              <tr key={name}>
                <td className={`${cell} font-mono`}>{name}</td>
                <td className={`${cell} font-mono text-muted-foreground`}>{type}</td>
                <td className={`${cell} text-muted-foreground`}>
                  {view.identity.includes(name) ? "identity" : Object.hasOwn(view.declared, name) ? "宣言済み" : "推論"}
                </td>
                <td className={`${cell} font-mono text-muted-foreground`}>
                  {Object.hasOwn(view.values, name) ? view.values[name]?.map(String).join(", ") : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

export function SchemaDialog({
  table,
  view,
  open,
  onOpenChange,
}: {
  table: string;
  view?: ViewMeta;
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
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{table} のスキーマ</DialogTitle>
          <DialogDescription>
            {view
              ? "VIEW は yamlite.yaml の expand から作られる読み取り専用の表です。"
              : "yamlite.yaml の宣言と、DB 上の状態です。変更は yamlite.yaml を編集してください。"}
          </DialogDescription>
        </DialogHeader>
        {view ? (
          <ViewSchema view={view} />
        ) : (
          <>
            {error && <p className="text-[12px] text-err">{error.message}</p>}
            {data && (
              <div className="flex flex-col gap-5 text-[12.5px]">
                <Section title="Table">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">path</dt>
                    <dd className="font-mono">{data.mode === "files" ? data.files : data.path}</dd>
                    <dt className="text-muted-foreground">key</dt>
                    <dd className="font-mono">{data.key}</dd>
                    <dt className="text-muted-foreground">DB</dt>
                    <dd>{data.inDb ? "テーブルあり" : "まだありません"}</dd>
                  </dl>
                </Section>
                <Section title="Columns">
                  <table className="w-full">
                    <tbody>
                      {Object.entries(data.columns).map(([name, type]) => (
                        <tr key={name}>
                          <td className={`${cell} font-mono`}>{name}</td>
                          <td className={`${cell} font-mono text-muted-foreground`}>{type}</td>
                          <td className={`${cell} text-muted-foreground`}>
                            {name === data.key ? "key" : name in data.declared ? "宣言済み" : "推論"}
                          </td>
                          <td className={`${cell} font-mono text-muted-foreground`}>
                            {Object.hasOwn(data.values, name) ? data.values[name]?.map(String).join(", ") : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
                <Section title="References">
                  {data.references.length === 0
                    ? empty
                    : data.references.map((r) => (
                        <div key={r.column} className="rounded-md border px-3 py-2">
                          <div className="flex items-center gap-2 font-mono">
                            <span>{r.column}</span>
                            <span className="text-muted-foreground">→</span>
                            <span>{`${r.table}.${r.target}`}</span>
                            <span
                              className={`ml-auto font-sans text-[11px] ${r.problems.length > 0 ? "text-warn" : "text-ok"}`}
                            >
                              {r.problems.length > 0 ? `⚠ ${r.problems.length} 件の参照切れ` : "OK"}
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
                      ))}
                </Section>
                <Section title="Indexes">
                  {data.indexes.length === 0 && data.otherIndexes.length === 0 ? (
                    empty
                  ) : (
                    <table className="w-full">
                      <tbody>
                        {data.indexes.map((i) => (
                          <tr key={i.name}>
                            <td className={`${cell} font-mono`}>{i.definition}</td>
                            <td className={`${cell} font-mono text-[11px] text-muted-foreground`}>{i.name}</td>
                            <td className={`${cell} ${i.inDb ? "text-ok" : "text-warn"}`}>
                              {i.inDb ? "作成済み" : "未作成"}
                            </td>
                          </tr>
                        ))}
                        {data.otherIndexes.map((name) => (
                          <tr key={name}>
                            <td className={`${cell} font-mono`}>{name}</td>
                            <td className={`${cell} text-[11px] text-muted-foreground`} colSpan={2}>
                              yamlite の管理外（SQL などで作成）
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {data.indexes.some((i) => !i.inDb) && (
                    <p className="text-[11px] text-muted-foreground">未作成の理由は Sync 画面の警告に出ます。</p>
                  )}
                </Section>
                <Section title="Expanded views">
                  {data.views.length === 0
                    ? empty
                    : data.views.map((v) => (
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
                              {v.inDb ? "作成済み" : "未作成"}
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
                      ))}
                </Section>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
