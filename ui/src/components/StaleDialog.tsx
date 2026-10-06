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
          <DialogTitle>他で変更されました</DialogTitle>
          <DialogDescription>読み込んだあとに、ファイルか DB で次のフィールドが変わりました。</DialogDescription>
        </DialogHeader>
        <FieldDiff
          labels={["いまの値", "あなたの編集"]}
          rows={stale.map((f) => ({
            field: f,
            a: JSON.stringify(current[f] ?? null),
            b: JSON.stringify(draft[f] ?? null),
          }))}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onReload}>
            最新を読み込む
          </Button>
          <Button onClick={onOverwrite}>上書き</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
