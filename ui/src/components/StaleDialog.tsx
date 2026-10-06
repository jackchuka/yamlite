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
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.record_stale_title()}</DialogTitle>
          <DialogDescription>{m.record_stale_description()}</DialogDescription>
        </DialogHeader>
        <FieldDiff
          labels={[m.record_stale_theirs(), m.record_stale_mine()]}
          rows={stale.map((f) => ({
            field: f,
            a: JSON.stringify(current[f] ?? null),
            b: JSON.stringify(draft[f] ?? null),
          }))}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onReload}>
            {m.record_reload()}
          </Button>
          <Button onClick={onOverwrite}>{m.record_overwrite()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
