import { useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { useAgentPanelOpen } from "@/lib/agent";
import { useAiProviders } from "@/lib/ai";
import { AppModeContext, useAppRoute } from "@/lib/appMode";
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
  return useAppRoute() ? (
    <AppModeContext.Provider value>
      <AppShell />
    </AppModeContext.Provider>
  ) : (
    <EditorShell />
  );
}

function ConfigError() {
  const { configError } = useEvents();
  if (!configError) return null;
  return (
    <div role="alert" className="bg-warn-soft px-4 py-2 text-[12px] text-warn">
      {m.shell_config_error({ error: configError })}
    </div>
  );
}

// an app is one page and nothing else: no sidebar, status bar or command menu leads into the editor
function AppShell() {
  const mobile = useIsMobile();
  return (
    <div className="grid h-[var(--y-shell-h,100dvh)] grid-cols-1 grid-rows-[auto_1fr]">
      <div>
        <SessionBanner />
        <ConfigError />
      </div>
      <main className="flex min-h-0 min-w-0">
        <Outlet />
      </main>
      <Toaster position={mobile ? "top-center" : "bottom-right"} />
      <ConflictToasts />
    </div>
  );
}

function EditorShell() {
  const [newTable, setNewTable] = useState(false);
  const mobile = useIsMobile();
  const ai = useAiProviders();
  const agentOpen = useAgentPanelOpen() && ai !== null;
  const [sidebarWidth, setSidebarWidth] = usePanelWidth("yamlite-sidebar-width", 220, SIDEBAR_BOUNDS);
  return (
    <div className="grid h-[var(--y-shell-h,100dvh)] grid-cols-1 grid-rows-[auto_1fr_auto]">
      <div>
        <SessionBanner />
        <ConfigError />
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
