import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api";
import { groupNames } from "@/lib/groups";
import { useEvents, useMeta } from "@/lib/providers";
import type { TableMeta } from "@/lib/types";
import { m } from "@/paraglide/messages.js";

// the sidebar group a table is listed under, written to yamlite.yaml
export function GroupButton({ table }: { table: TableMeta }) {
  const client = useQueryClient();
  const { connected } = useEvents();
  const { data: meta } = useMeta();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(table.group ?? "");
  const save = useMutation({
    mutationFn: (group: string | null) => api.setGroup(table.name, group),
    onSuccess: async () => {
      setOpen(false);
      await client.invalidateQueries({ queryKey: ["meta"] });
    },
  });
  const onOpenChange = (next: boolean) => {
    if (next) {
      setValue(table.group ?? "");
      save.reset();
    }
    setOpen(next);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={m.table_group_label({ group: table.group ?? m.table_group_none() })}
        >
          <Tag className="size-3.5" /> {table.group ?? m.table_group()}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[min(16rem,calc(100vw-2rem))] flex-col gap-2 p-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(value.trim() === "" ? null : value.trim());
          }}
        >
          <label className="text-[11.5px] font-semibold text-muted-foreground">
            {m.table_group()}
            <Input
              aria-label={m.table_group_name()}
              role="combobox"
              list={listId}
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              className="mt-1"
            />
          </label>
          <datalist id={listId}>
            {groupNames(meta?.tables ?? []).map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          {save.error && <p className="text-[11px] text-err">{save.error.message}</p>}
          <div className="flex justify-end gap-2">
            {table.group !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={save.isPending || !connected}
                onClick={() => save.mutate(null)}
              >
                {m.table_ungroup()}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={save.isPending || !connected}>
              {m.common_save()}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
