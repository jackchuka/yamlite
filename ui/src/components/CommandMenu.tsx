import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { isReadOnly } from "@/lib/mode";
import { useMeta } from "@/lib/providers";

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="テーブルや画面を検索…" />
      <CommandList>
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
        <CommandGroup heading="Tools">
          <CommandItem onSelect={() => go(() => navigate({ to: "/sql" }))}>SQL console</CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/erd" }))}>ERD</CommandItem>
          {!isReadOnly() && <CommandItem onSelect={() => go(() => navigate({ to: "/sync" }))}>Sync</CommandItem>}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
