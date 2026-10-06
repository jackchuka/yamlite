import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { fieldError } from "@/lib/fielderror";
import { useReflectDispatch } from "@/lib/providers";
import type { TableMeta } from "@/lib/types";
import { m } from "@/paraglide/messages.js";

export function RenameKeyDialog({
  table,
  recordKey,
  open,
  onOpenChange,
}: {
  table: TableMeta;
  recordKey: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const dispatch = useReflectDispatch();
  const [to, setTo] = useState(recordKey);
  const rename = useMutation({
    mutationFn: () => api.rename(table.name, recordKey, to),
    onMutate: () => dispatch({ type: "saved", table: table.name, key: to, at: Date.now() }),
    onError: () => dispatch({ type: "cancelled", table: table.name, key: to }),
    onSuccess: () => {
      onOpenChange(false);
      void navigate({ to: "/t/$table", params: { table: table.name }, search: (p) => ({ ...p, key: to }) });
    },
  });
  const err = fieldError(rename.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.dialog_rename_title()}</DialogTitle>
          <DialogDescription>
            {table.mode === "files" ? m.dialog_rename_files() : m.dialog_rename_list()}
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label={m.dialog_new_key()}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="font-mono"
        />
        {err && <p className="text-[11px] text-err">{err.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m.common_cancel()}
          </Button>
          <Button disabled={to === "" || to === recordKey || rename.isPending} onClick={() => rename.mutate()}>
            {m.dialog_rename()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
