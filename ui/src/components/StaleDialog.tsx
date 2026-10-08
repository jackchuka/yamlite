import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Row } from "@/lib/types";
import { FieldDiff } from "./FieldDiff";
import { m } from "@/paraglide/messages.js";

export function StaleDialog({
  stale,
  current,
  draft,
  onReload,
  onOverwrite,
  onClose,
}: {
  stale: string[];
  current: Row;
  draft: Row;
  onReload: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}) {
  const reload = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* the diff's fold buttons come first in tab order; start on the choice the dialog asks for */}
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          reload.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{m.record_stale_title()}</DialogTitle>
          <DialogDescription>{m.record_stale_description()}</DialogDescription>
        </DialogHeader>
        <FieldDiff
          labels={[m.record_stale_theirs(), m.record_stale_mine()]}
          format={(v) => JSON.stringify(v ?? null)}
          rows={stale.map((f) => ({ field: f, a: current[f], b: draft[f] }))}
        />
        <DialogFooter>
          <Button ref={reload} variant="outline" onClick={onReload}>
            {m.record_reload()}
          </Button>
          <Button onClick={onOverwrite}>{m.record_overwrite()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
