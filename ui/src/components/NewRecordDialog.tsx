import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { fieldError } from "@/lib/fielderror";
import { cn } from "@/lib/utils";
import { useEvents, useReflectDispatch } from "@/lib/providers";
import type { Row, TableMeta } from "@/lib/types";
import { FormField } from "./FormField";
import { m } from "@/paraglide/messages.js";

export function NewRecordDialog({
  table,
  open,
  onOpenChange,
  initial = {},
}: {
  table: TableMeta;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Row;
}) {
  const navigate = useNavigate();
  const { connected } = useEvents();
  const dispatch = useReflectDispatch();
  const [key, setKey] = useState("");
  const [values, setValues] = useState<Row>(initial);
  // a field picks its widget once per mount, so a reset remounts them rather than feed a map widget null
  const [generation, setGeneration] = useState(0);
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
      setValues(initial);
      setGeneration((g) => g + 1);
      void navigate({
        to: "/t/$table",
        params: { table: table.name },
        search: (prev) => ({ ...prev, key }),
      });
    },
  });
  const err = fieldError(create.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent pinned className="sm:max-w-2xl">
        <DialogHeader pinned>
          <DialogTitle>{m.dialog_add_to({ table: table.name })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <label className={fieldLabel}>
            {(table.mode === "files" ? m.dialog_key_is_file : m.dialog_key_is_key)({ key: table.key })}
            <Input
              aria-label={m.dialog_new_key()}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="mt-1 font-mono"
            />
          </label>
          {err?.field === "key" && <p className="text-[11px] text-err">{err.message}</p>}
          {Object.entries(table.columns)
            .filter(([c]) => c !== table.key)
            .map(([c, type]) => (
              <div key={`${generation}:${c}`}>
                <FormField
                  path={[c]}
                  label={
                    <div
                      className={cn(
                        "flex-1",
                        fieldLabel,
                        table.required.includes(c) && values[c] == null && "text-warn",
                      )}
                    >
                      {c}
                      {table.required.includes(c) && <span aria-label={m.record_required()}> *</span>}
                    </div>
                  }
                  value={values[c] ?? null}
                  type={type}
                  format={Object.hasOwn(table.formats, c) ? table.formats[c] : undefined}
                  mdx={table.files?.endsWith(".mdx")}
                  allowed={Object.hasOwn(table.values, c) ? table.values[c] : undefined}
                  min={Object.hasOwn(table.min, c) ? table.min[c] : undefined}
                  max={Object.hasOwn(table.max, c) ? table.max[c] : undefined}
                  reference={table.references.find((r) => r.column === c)}
                  onChange={(next) => setValues({ ...values, [c]: next })}
                />
              </div>
            ))}
          {err && err.field !== "key" && <p className="text-[11px] text-err">{err.message}</p>}
        </DialogBody>
        <DialogFooter pinned>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m.common_cancel()}
          </Button>
          <Button
            disabled={key === "" || create.isPending || !connected}
            title={connected ? undefined : m.common_disconnected_hint()}
            onClick={() => create.mutate()}
          >
            {m.form_add_record()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
