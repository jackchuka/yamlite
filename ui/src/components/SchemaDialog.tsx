import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";

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

export function SchemaDialog({
  table,
  open,
  onOpenChange,
}: {
  table: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data, error } = useQuery({ queryKey: ["schema", table], queryFn: () => api.schema(table), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{table} のスキーマ</DialogTitle>
          <DialogDescription>
            yamlite.yaml の宣言と、DB 上の状態です。変更は yamlite.yaml を編集してください。
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-[12px] text-err">{error.message}</p>}
        {data && (
          <div className="flex flex-col gap-5 text-[12.5px]">
            <Section title="Table">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">path</dt>
                <dd className="font-mono">{data.mode === "dir" ? `${data.path}/*.yaml` : data.path}</dd>
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
