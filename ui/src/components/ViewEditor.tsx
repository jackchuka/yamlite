import { useState } from "react";
import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";
import { fieldWidth, selectControl } from "@/components/ui/field";
import { SectionCard } from "@/components/ui/section-card";
import { removeButton } from "./IndexEditor";

export function ViewEditor({
  fields,
  names,
  json,
  onChange,
}: {
  // the fields expanded directly under the target
  fields: string[];
  // the existing views by field
  names: Record<string, string>;
  // the target's JSON columns
  json: string[];
  onChange: (next: string[]) => void;
}) {
  const left = json.filter((c) => !fields.includes(c));
  const [adding, setAdding] = useState(false);
  const [field, setField] = useState("");
  const chosen = left.includes(field) ? field : "";
  const label = (f: string) => (Object.hasOwn(names, f) ? (names[f] as string) : f);

  const close = () => {
    setAdding(false);
    setField("");
  };
  const remove = (f: string) => {
    if (Object.hasOwn(names, f) && !window.confirm(m.rules_remove_view_confirm({ view: label(f) }))) return;
    onChange(fields.filter((x) => x !== f));
  };

  return (
    <SectionCard
      title={m.schema_expanded_views()}
      actions={
        left.length > 0 &&
        !adding && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            {`+ ${m.rules_add_view()}`}
          </Button>
        )
      }
    >
      {fields.length > 0 && (
        <ul className="flex flex-col gap-1">
          {fields.map((f) => (
            <li key={f} className="flex items-center gap-3 rounded-md border px-3 py-1.5">
              <span className="font-mono">{label(f)}</span>
              <button
                type="button"
                aria-label={m.rules_remove_view({ view: label(f) })}
                className={`${removeButton} ml-auto`}
                onClick={() => remove(f)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {left.length === 0 ? (
        <p className="text-muted-foreground">{m.rules_no_json_columns()}</p>
      ) : adding ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
          <select
            aria-label={m.rules_view_column()}
            className={`${selectControl} ${fieldWidth} font-mono`}
            value={chosen}
            onChange={(e) => setField(e.target.value)}
          >
            <option value="">{"—"}</option>
            {left.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {m.rules_cancel()}
            </Button>
            <Button
              type="button"
              disabled={chosen === ""}
              onClick={() => {
                onChange([...fields, chosen]);
                close();
              }}
            >
              {m.rules_add_view()}
            </Button>
          </div>
        </div>
      ) : (
        fields.length === 0 && <p className="text-muted-foreground">{m.schema_none()}</p>
      )}
    </SectionCard>
  );
}
