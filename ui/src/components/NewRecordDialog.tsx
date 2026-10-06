import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { fieldError } from "@/lib/fielderror";
import { useEvents, useReflectDispatch } from "@/lib/providers";
import type { Row, TableMeta } from "@/lib/types";
import { FormField } from "./FormField";

export function NewRecordDialog({
  table,
  open,
  onOpenChange,
}: {
  table: TableMeta;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const { connected } = useEvents();
  const dispatch = useReflectDispatch();
  const [key, setKey] = useState("");
  const [values, setValues] = useState<Row>({});
  const create = useMutation({
    mutationFn: () => {
      const set = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== null && v !== undefined && v !== ""),
      );
      return api.create(table.name, key, set);
    },
    onMutate: () => dispatch({ type: "saved", table: table.name, key, at: Date.now() }),
    onError: () => dispatch({ type: "cancelled", table: table.name, key }),
    onSuccess: () => {
      onOpenChange(false);
      setKey("");
      setValues({});
      void navigate({ to: "/t/$table", params: { table: table.name }, search: { key } });
    },
  });
  const err = fieldError(create.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-auto md:max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{table.name} に追加</DialogTitle>
        </DialogHeader>
        <label className="text-[11.5px] font-semibold text-muted-foreground">
          {table.key}（{table.mode === "files" ? "ファイル名になります" : "キー"}）
          <Input aria-label="new key" value={key} onChange={(e) => setKey(e.target.value)} className="mt-1 font-mono" />
        </label>
        {err?.field === "key" && <p className="text-[11px] text-err">{err.message}</p>}
        {Object.entries(table.columns)
          .filter(([c]) => c !== table.key)
          .map(([c, type]) => (
            <div key={c}>
              <div
                className={`mb-1 text-[11.5px] font-semibold ${table.required.includes(c) && values[c] == null ? "text-warn" : "text-muted-foreground"}`}
              >
                {c}
                {table.required.includes(c) && <span aria-label="required"> *</span>}
              </div>
              <FormField
                path={[c]}
                value={values[c] ?? null}
                type={type}
                format={Object.hasOwn(table.formats, c) ? table.formats[c] : undefined}
                allowed={Object.hasOwn(table.values, c) ? table.values[c] : undefined}
                min={Object.hasOwn(table.min, c) ? table.min[c] : undefined}
                max={Object.hasOwn(table.max, c) ? table.max[c] : undefined}
                reference={table.references.find((r) => r.column === c)}
                onChange={(next) => setValues({ ...values, [c]: next })}
              />
            </div>
          ))}
        {err && err.field !== "key" && <p className="text-[11px] text-err">{err.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button
            disabled={key === "" || create.isPending || !connected}
            title={connected ? undefined : "disconnected"}
            onClick={() => create.mutate()}
          >
            追加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
