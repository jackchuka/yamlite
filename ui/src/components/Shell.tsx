import { useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { useAgentPanelOpen, useAgents } from "@/lib/agent";
import { useEvents } from "@/lib/providers";
import { useIsMobile } from "@/lib/useIsMobile";
import { AgentPanel } from "./AgentPanel";
import { CommandMenu } from "./CommandMenu";
import { SessionBanner } from "./SessionBanner";
import { ConflictToasts } from "./ConflictToasts";
import { NewTableDialog } from "./NewTableDialog";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";

export function Shell() {
  const { configError } = useEvents();
  const [newTable, setNewTable] = useState(false);
  const mobile = useIsMobile();
  const agents = useAgents();
  const agentOpen = useAgentPanelOpen() && agents.length > 0;
  return (
    <div className="grid h-dvh grid-cols-1 grid-rows-[auto_1fr_auto]">
      <div>
        <SessionBanner />
        {configError && (
          <div role="alert" className="bg-warn-soft px-4 py-2 text-[12px] text-warn">
            yamlite.yaml を読み込めません。前回の設定で同期を続けています: {configError}
          </div>
        )}
        {mobile && <MobileNav onNewTable={() => setNewTable(true)} />}
      </div>
      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[220px_1fr]">
        {!mobile && <Sidebar onNewTable={() => setNewTable(true)} />}
        <main className="flex min-h-0 min-w-0">
          <div className="flex min-h-0 min-w-0 flex-1">
            <Outlet />
          </div>
          {agentOpen && <AgentPanel />}
        </main>
      </div>
      <StatusBar />
      <CommandMenu />
      {newTable && <NewTableDialog open onOpenChange={setNewTable} />}
      <Toaster position={mobile ? "top-center" : "bottom-right"} />
      <ConflictToasts />
    </div>
  );
}
