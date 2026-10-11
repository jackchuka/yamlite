import { useState } from "react";
import { Button } from "@/components/ui/button";
import { chip, fieldWidth, selectControl } from "@/components/ui/field";
import { SectionCard } from "@/components/ui/section-card";
import { describeIndex } from "@/lib/rules";
import type { IndexEdit, IndexInfo } from "@/lib/types";
import { m } from "@/paraglide/messages.js";

export const removeButton = "px-1 text-[15px] text-muted-foreground hover:text-foreground";

export function IndexEditor({
  indexes,
  known,
  columns,
  onChange,
}: {
  indexes: IndexEdit[];
  // what the schema says about the indexes already declared
  known: IndexInfo[];
  columns: string[];
  onChange: (next: IndexEdit[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [column, setColumn] = useState("");
  const [unique, setUnique] = useState(false);
  const status = new Map(known.map((i) => [i.definition, i.inDb]));
  const left = columns.filter((c) => !picked.includes(c));

  const close = () => {
    setAdding(false);
    setPicked([]);
    setColumn("");
    setUnique(false);
  };
  const add = () => {
    const next: IndexEdit = { columns: picked, unique };
    const label = describeIndex(next);
    if (!indexes.some((i) => describeIndex(i) === label)) onChange([...indexes, next]);
    close();
  };

  return (
    <SectionCard
      title={m.schema_indexes()}
      actions={
        !adding && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            {`+ ${m.rules_add_index()}`}
          </Button>
        )
      }
    >
      {indexes.length === 0 && !adding && <p className="text-muted-foreground">{m.schema_none()}</p>}
      {indexes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {indexes.map((i) => {
            const label = describeIndex(i);
            const inDb = status.get(label);
            return (
              <li key={label} className="flex items-center gap-3 rounded-md border px-3 py-1.5">
                <span className="font-mono">{label}</span>
                {inDb !== undefined && (
                  <span className={`ml-auto text-[12px] ${inDb ? "text-ok" : "text-warn"}`}>
                    {inDb ? m.schema_created() : m.schema_not_created()}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={m.rules_remove_index({ index: label })}
                  className={`${removeButton} ${inDb === undefined ? "ml-auto" : ""}`}
                  onClick={() => onChange(indexes.filter((x) => describeIndex(x) !== label))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
          {picked.length > 0 && (
            <ol className="flex flex-wrap gap-1.5">
              {picked.map((c) => (
                <li key={c} className={chip}>
                  <span>{c}</span>
                  <button
                    type="button"
                    aria-label={m.rules_remove_column({ column: c })}
                    className="ml-1 px-1 opacity-60 hover:opacity-100"
                    onClick={() => setPicked(picked.filter((x) => x !== c))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={m.rules_index_column()}
              className={`${selectControl} ${fieldWidth} font-mono`}
              value={column}
              onChange={(e) => setColumn(e.target.value)}
            >
              <option value="">{"—"}</option>
              {left.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              disabled={column === ""}
              onClick={() => {
                setPicked([...picked, column]);
                setColumn("");
              }}
            >
              {m.rules_add_column()}
            </Button>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={m.rules_unique()}
                className="size-4"
                checked={unique}
                onChange={(e) => setUnique(e.target.checked)}
              />
              <span>{m.rules_unique()}</span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {m.rules_cancel()}
            </Button>
            <Button type="button" disabled={picked.length === 0} onClick={add}>
              {m.rules_add_index()}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
