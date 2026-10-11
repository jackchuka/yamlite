import { useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { useAgentPanelOpen, useAgents } from "@/lib/agent";
import { useEvents } from "@/lib/providers";
import { SIDEBAR_BOUNDS, usePanelWidth } from "@/lib/panelWidth";
import { useIsMobile } from "@/lib/useIsMobile";
import { AgentPanel } from "./AgentPanel";
import { CommandMenu } from "./CommandMenu";
import { SessionBanner } from "./SessionBanner";
import { ConflictToasts } from "./ConflictToasts";
import { NewTableDialog } from "./NewTableDialog";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { m } from "@/paraglide/messages.js";

export function Shell() {
  const { configError } = useEvents();
  const [newTable, setNewTable] = useState(false);
  const mobile = useIsMobile();
  const agents = useAgents();
  const agentOpen = useAgentPanelOpen() && agents.length > 0;
  const [sidebarWidth, setSidebarWidth] = usePanelWidth("yamlite-sidebar-width", 220, SIDEBAR_BOUNDS);
  return (
    <div className="grid h-[var(--y-shell-h,100dvh)] grid-cols-1 grid-rows-[auto_1fr_auto]">
      <div>
        <SessionBanner />
        {configError && (
          <div role="alert" className="bg-warn-soft px-4 py-2 text-[12px] text-warn">
            {m.shell_config_error({ error: configError })}
          </div>
        )}
        {mobile && <MobileNav onNewTable={() => setNewTable(true)} />}
      </div>
      <div
        className="grid min-h-0 grid-cols-1"
        style={mobile ? undefined : { gridTemplateColumns: `${sidebarWidth}px 1fr` }}
      >
        {!mobile && (
          <div className="relative min-h-0">
            <Sidebar onNewTable={() => setNewTable(true)} />
            <PanelResizeHandle
              width={sidebarWidth}
              label={m.nav_sidebar_resize()}
              onResize={setSidebarWidth}
              edge="right"
              bounds={SIDEBAR_BOUNDS}
            />
          </div>
        )}
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
