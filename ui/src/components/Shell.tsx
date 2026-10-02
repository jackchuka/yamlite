import { useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { useEvents } from "@/lib/providers";
import { CommandMenu } from "./CommandMenu";
import { SessionBanner } from "./SessionBanner";
import { ConflictToasts } from "./ConflictToasts";
import { NewTableDialog } from "./NewTableDialog";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";

export function Shell() {
  const { configError } = useEvents();
  const [newTable, setNewTable] = useState(false);
  return (
    <div className="grid h-full grid-rows-[auto_1fr_30px]">
      <div>
        <SessionBanner />
        {configError && (
          <div role="alert" className="bg-warn-soft px-4 py-2 text-[12px] text-warn">
            yamlite.yaml を読み込めません。前回の設定で同期を続けています: {configError}
          </div>
        )}
      </div>
      <div className="grid min-h-0 grid-cols-[220px_1fr]">
        <Sidebar onNewTable={() => setNewTable(true)} />
        <main className="flex min-h-0 min-w-0">
          <Outlet />
        </main>
      </div>
      <StatusBar />
      <CommandMenu />
      {newTable && <NewTableDialog open onOpenChange={setNewTable} />}
      <Toaster position="bottom-right" />
      <ConflictToasts />
    </div>
  );
}
