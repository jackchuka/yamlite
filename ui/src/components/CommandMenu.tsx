import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { agentPanel, useAgents } from "@/lib/agent";
import { setCommandMenuOpen, useCommandMenuOpen } from "@/lib/commandMenu";
import { isReadOnly } from "@/lib/mode";
import { useMeta } from "@/lib/providers";

export function CommandMenu() {
  const open = useCommandMenuOpen();
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const agents = useAgents();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandMenuOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const go = (fn: () => void) => {
    setCommandMenuOpen(false);
    fn();
  };
  return (
    <CommandDialog open={open} onOpenChange={setCommandMenuOpen}>
      <CommandInput placeholder="テーブルや画面を検索…" className="max-md:pr-10" />
      <CommandList className="max-md:max-h-none">
        <CommandEmpty>見つかりません</CommandEmpty>
        <CommandGroup heading="Tables">
          {meta?.tables.map((t) => (
            <CommandItem
              key={t.name}
              onSelect={() => go(() => navigate({ to: "/t/$table", params: { table: t.name } }))}
            >
              {t.name}
            </CommandItem>
          ))}
        </CommandGroup>
        {meta && meta.views.length > 0 && (
          <CommandGroup heading="Views">
            {meta.views.map((v) => (
              <CommandItem
                key={v.name}
                onSelect={() => go(() => navigate({ to: "/t/$table", params: { table: v.name } }))}
              >
                {v.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {meta && meta.pages.length > 0 && (
          <CommandGroup heading="Pages">
            {meta.pages.map((p) => (
              <CommandItem
                key={p.name}
                onSelect={() => go(() => navigate({ to: "/p/$page", params: { page: p.name } }))}
              >
                {p.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Tools">
          <CommandItem onSelect={() => go(() => navigate({ to: "/sql" }))}>SQL console</CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/erd" }))}>ERD</CommandItem>
          {!isReadOnly() && <CommandItem onSelect={() => go(() => navigate({ to: "/sync" }))}>Sync</CommandItem>}
          {agents.length > 0 && <CommandItem onSelect={() => go(agentPanel.open)}>AI に依頼</CommandItem>}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
