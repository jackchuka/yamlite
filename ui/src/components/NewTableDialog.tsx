import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { fieldError } from "@/lib/fielderror";
import { groupNames } from "@/lib/groups";
import { useEvents, useMeta } from "@/lib/providers";
import type { ColumnType } from "@/lib/types";

const TYPES: ColumnType[] = ["TEXT", "INTEGER", "REAL", "BOOLEAN", "JSON"];

export function NewTableDialog({
  open,
  onOpenChange,
  adopt,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  adopt?: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { connected } = useEvents();
  const { data: meta } = useMeta();
  const groupList = useId();
  const [group, setGroup] = useState("");
  const [name, setName] = useState(adopt ?? "");
  const [mode, setMode] = useState<"files" | "list">("files");
  const [key, setKey] = useState("id");
  const [columns, setColumns] = useState<Array<{ name: string; type: ColumnType }>>([]);
  const create = useMutation({
    mutationFn: () =>
      api.createTable({
        name,
        mode,
        key,
        columns: Object.fromEntries(columns.filter((c) => c.name !== "").map((c) => [c.name, c.type])),
        group: group.trim() === "" ? undefined : group.trim(),
      }),
    onSuccess: async () => {
      onOpenChange(false);
      await client.invalidateQueries({ queryKey: ["meta"] });
      void navigate({ to: "/t/$table", params: { table: name } });
    },
  });
  const err = fieldError(create.error);
  const errorFor = (field: string) =>
    err?.field === field ? <p className="text-[11px] text-err">{err.message}</p> : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{adopt ? `${adopt} を yamlite.yaml に追加` : "新しいテーブル"}</DialogTitle>
        </DialogHeader>
        <label className="text-[11.5px] font-semibold text-muted-foreground">
          名前
          <Input
            aria-label="table name"
            value={name}
            disabled={adopt !== undefined}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 font-mono"
          />
        </label>
        {errorFor("name")}
        <fieldset className="flex gap-4 text-[12px]">
          <label>
            <input type="radio" checked={mode === "files"} onChange={() => setMode("files")} /> フォルダ（1 レコード 1
            ファイル: {name || "name"}/*.yaml）
          </label>
          <label>
            <input type="radio" checked={mode === "list"} onChange={() => setMode("list")} /> 1 ファイルのリスト（
            {name || "name"}.yaml）
          </label>
        </fieldset>
        <label className="text-[11.5px] font-semibold text-muted-foreground">
          キー列
          <Input
            aria-label="key column"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="mt-1 font-mono"
          />
        </label>
        {errorFor("key")}
        <label className="text-[11.5px] font-semibold text-muted-foreground">
          グループ（任意）
          <Input
            aria-label="group name"
            list={groupList}
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="mt-1"
          />
        </label>
        <datalist id={groupList}>
          {groupNames(meta?.tables ?? []).map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        {errorFor("group")}
        {!adopt && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold text-muted-foreground">
              列（あとで YAML に書いても自動で増えます）
            </span>
            {columns.map((c, i) => (
              <div key={i} className="flex gap-1.5">
                <Input
                  aria-label={`column ${i + 1} name`}
                  value={c.name}
                  onChange={(e) => setColumns(columns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  className="font-mono"
                />
                <select
                  aria-label={`column ${i + 1} type`}
                  className="rounded border bg-background px-2"
                  value={c.type}
                  onChange={(e) =>
                    setColumns(columns.map((x, j) => (j === i ? { ...x, type: e.target.value as ColumnType } : x)))
                  }
                >
                  {TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`remove column ${i + 1}`}
                  onClick={() => setColumns(columns.filter((_, j) => j !== i))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setColumns([...columns, { name: "", type: "TEXT" }])}>
              + 列
            </Button>
            {errorFor("columns")}
          </div>
        )}
        {err && err.field === null && <p className="text-[11px] text-err">{err.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button
            disabled={name === "" || create.isPending || !connected}
            title={connected ? undefined : "disconnected"}
            onClick={() => create.mutate()}
          >
            作成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
