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
        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 font-mono text-[12px]">
          <span />
          <span className="font-sans text-muted-foreground">いまの値</span>
          <span className="font-sans text-muted-foreground">あなたの編集</span>
          {stale.map((f) => (
            <div key={f} className="contents">
              <span className="text-syn-key">{f}</span>
              <span>{JSON.stringify(current[f] ?? null)}</span>
              <span>{JSON.stringify(draft[f] ?? null)}</span>
            </div>
          ))}
        </div>
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
