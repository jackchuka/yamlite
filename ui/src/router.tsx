import { useState } from "react";
import { createHashHistory, createRoute, createRouter, Navigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { NewRecordDialog } from "./components/NewRecordDialog";
import { Placeholder } from "./components/Placeholder";
import { RecordDrawer } from "./components/RecordDrawer";
import { RenameKeyDialog } from "./components/RenameKeyDialog";
import { Shell } from "./components/Shell";
import { SqlConsole } from "./components/SqlConsole";
import { SyncView } from "./components/SyncView";
import { TableView } from "./components/TableView";
import { isReadOnly } from "./lib/mode";
import { useEvents, useMeta } from "./lib/providers";
import type { TableMeta } from "./lib/types";
import { rootRoute, sqlRoute, syncRoute, tableRoute } from "./routes";

function Home() {
  const { data } = useMeta();
  const first = data?.tables[0];
  if (!data) return null;
  if (!first) return <Placeholder title="テーブルがありません" />;
  return <Navigate to="/t/$table" params={{ table: first.name }} />;
}

function NewRecordButton({ table }: { table: TableMeta }) {
  const [open, setOpen] = useState(false);
  const { connected } = useEvents();
  return (
    <>
      <Button
        size="sm"
        disabled={!connected}
        title={connected ? undefined : "disconnected"}
        onClick={() => setOpen(true)}
      >
        + New record
      </Button>
      <NewRecordDialog table={table} open={open} onOpenChange={setOpen} />
    </>
  );
}

function RenameButton({ table, recordKey }: { table: TableMeta; recordKey: string }) {
  const [open, setOpen] = useState(false);
  const { connected } = useEvents();
  return (
    <>
      <button
        type="button"
        aria-label="rename key"
        disabled={!connected}
        className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        onClick={() => setOpen(true)}
      >
        rename
      </button>
      {open && <RenameKeyDialog table={table} recordKey={recordKey} open onOpenChange={setOpen} />}
    </>
  );
}

function TablePage() {
  const { table } = tableRoute.useParams();
  return (
    <TableView
      key={table}
      headerActions={isReadOnly() ? undefined : (t) => <NewRecordButton table={t} />}
      drawer={(t, key) => (
        <RecordDrawer
          key={`${t.name}:${key}`}
          table={t}
          recordKey={key}
          headerActions={isReadOnly() ? undefined : <RenameButton table={t} recordKey={key} />}
        />
      )}
    />
  );
}

rootRoute.update({ component: Shell });
tableRoute.update({ component: TablePage });
sqlRoute.update({ component: SqlConsole });
syncRoute.update({ component: () => (isReadOnly() ? <Navigate to="/" /> : <SyncView />) });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, tableRoute, sqlRoute, syncRoute]),
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
