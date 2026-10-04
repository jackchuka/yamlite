export function LoadFailure({ error, protocol = location.protocol }: { error: unknown; protocol?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-base font-semibold">スナップショットを読み込めませんでした</p>
      <p className="font-mono text-[12px] text-err">{message}</p>
      {protocol === "file:" && (
        <p className="text-[12px] text-muted-foreground">
          file:// では開けません。このフォルダを Web サーバー経由で開いてください（例: npx serve）。
        </p>
      )}
    </div>
  );
}
