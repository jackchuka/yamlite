import { json } from "@codemirror/lang-json";
import { useQuery } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { emptyValueFor, fieldKind } from "@/lib/form";
import type { ColumnType, Reference } from "@/lib/types";

export interface FieldProps {
  path: Array<string | number>;
  value: unknown;
  type?: ColumnType;
  reference?: Reference;
  onChange: (next: unknown) => void;
  onRemove?: () => void;
  onValidity?: (path: string, ok: boolean) => void;
  readOnly?: boolean;
}

const label = (path: Array<string | number>) => path.join(".");
const isDark = () => document.documentElement.dataset.theme === "dark";

function ChipsInput({
  path,
  value,
  onChange,
}: {
  path: Array<string | number>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (t !== "") onChange([...value, t]);
    setText("");
  };
  return (
    <div className="flex flex-wrap gap-1 rounded-md border bg-background px-1.5 py-1">
      {value.map((chip, i) => (
        <span
          key={`${i}-${chip}`}
          className="inline-flex items-center rounded-full bg-chip pl-2 pr-1 text-[11.5px] text-chip-foreground"
        >
          {chip}
          <button
            type="button"
            aria-label={`remove ${chip}`}
            className="ml-1 opacity-60"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label={label(path)}
        className="min-w-16 flex-1 bg-transparent px-1 outline-none"
        placeholder="+ add"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function JsonField({ path, value, onChange, onValidity, readOnly }: FieldProps) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  // the value this editor last handed to its parent; anything else arriving as a prop came from outside
  const emitted = useRef(JSON.stringify(value));
  const validity = useRef(onValidity);
  validity.current = onValidity;
  const id = label(path);

  useEffect(() => {
    if (JSON.stringify(value) === emitted.current) return;
    emitted.current = JSON.stringify(value);
    setText(JSON.stringify(value, null, 2));
    setError(null);
    validity.current?.(id, true);
  }, [value, id]);
  useEffect(() => () => validity.current?.(id, true), [id]);

  return (
    <div>
      <CodeMirror
        aria-label={id}
        value={text}
        extensions={[json()]}
        theme={isDark() ? "dark" : "light"}
        editable={!readOnly}
        basicSetup={{ lineNumbers: false, foldGutter: false }}
        className="overflow-hidden rounded-md border text-[12px]"
        onChange={(next) => {
          setText(next);
          try {
            const parsed: unknown = JSON.parse(next);
            emitted.current = JSON.stringify(parsed);
            onChange(parsed);
            setError(null);
            onValidity?.(id, true);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            onValidity?.(id, false);
          }
        }}
      />
      {error && <p className="mt-1 text-[11px] text-err">{error}</p>}
    </div>
  );
}

function RefField({ path, value, reference, onChange }: FieldProps) {
  const target = reference?.table ?? "";
  const { data } = useQuery({
    queryKey: ["refKeys", target],
    queryFn: () => api.rows(target, { limit: 500, offset: 0, filters: [] }),
    enabled: target !== "",
  });
  const listId = `ref-${label(path)}`;
  return (
    <>
      <Input
        aria-label={label(path)}
        list={listId}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      />
      <datalist id={listId}>
        {data?.rows.map((r) => {
          const key = String(r[reference?.target ?? "id"] ?? Object.values(r)[0]);
          return <option key={key} value={key} />;
        })}
      </datalist>
    </>
  );
}

function MapField(props: FieldProps) {
  const { path, value, onChange } = props;
  const entries = Object.entries(value as Record<string, unknown>);
  const [newKey, setNewKey] = useState<string | null>(null);
  return (
    <div className="rounded-lg border bg-panel px-2.5 pt-2.5 pb-1">
      {entries.map(([k, v]) => (
        <div key={k} className="mb-2.5 grid grid-cols-[minmax(34px,auto)_1fr_auto] items-start gap-1.5">
          <span className="pt-1.5 font-mono text-[11px] text-syn-key">{k}</span>
          <FormField
            {...props}
            path={[...path, k]}
            value={v}
            type={undefined}
            reference={undefined}
            onChange={(next) => onChange({ ...(value as object), [k]: next })}
          />
          <button
            type="button"
            aria-label={`remove ${label([...path, k])}`}
            className="pt-1.5 text-muted-foreground"
            onClick={() => {
              const { [k]: _gone, ...rest } = value as Record<string, unknown>;
              onChange(rest);
            }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {newKey === null ? (
        <button type="button" className="pb-2 text-[11.5px] text-muted-foreground" onClick={() => setNewKey("")}>
          + key
        </button>
      ) : (
        <Input
          autoFocus
          aria-label={`new key in ${label(path)}`}
          className="mb-2 h-7"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newKey.trim() !== "") {
              onChange({ ...(value as object), [newKey.trim()]: "" });
              setNewKey(null);
            }
            if (e.key === "Escape") setNewKey(null);
          }}
        />
      )}
    </div>
  );
}

const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

// the widget is chosen once per mount so typing never swaps it; the parent remounts on reload
export function FormField(props: FieldProps) {
  const { path, value, type, reference, onChange } = props;
  const [kind, setKind] = useState(() => fieldKind(value, type, reference !== undefined));
  const [numText, setNumText] = useState(value == null ? "" : String(value));
  const text = value == null ? "" : String(value);
  const change = (next: unknown, chosen?: typeof kind) => {
    if (kind === "unset") {
      setKind(chosen ?? fieldKind(next, type, false));
      setNumText(next == null ? "" : String(next));
    }
    onChange(next);
  };
  switch (kind) {
    case "switch":
      return <Switch aria-label={label(path)} checked={value === true} onCheckedChange={change} />;
    case "number":
    case "bigint":
      return (
        <Input
          aria-label={label(path)}
          inputMode={type === "REAL" ? "decimal" : "numeric"}
          className="w-40 font-mono"
          value={numText}
          onChange={(e) => {
            const raw = e.target.value;
            setNumText(raw);
            const t = raw.trim();
            if (type === "INTEGER") {
              if (!INTEGER.test(t)) return;
              const n = Number(t);
              // past 2^53 the digits only survive as a string
              onChange(Number.isSafeInteger(n) ? n : t);
              return;
            }
            if (DECIMAL.test(t) && Number.isFinite(Number(t))) onChange(Number(t));
          }}
        />
      );
    case "text":
      return <Input aria-label={label(path)} value={text} onChange={(e) => change(e.target.value)} />;
    case "textarea":
      return <Textarea aria-label={label(path)} rows={4} value={text} onChange={(e) => change(e.target.value)} />;
    case "ref":
      return <RefField {...props} />;
    case "chips":
      return <ChipsInput path={path} value={value as string[]} onChange={onChange} />;
    case "map":
      return <MapField {...props} />;
    case "json":
      return <JsonField {...props} />;
    case "unset":
      if (type === "JSON") {
        const choices = [
          { name: "map", text: "{ } map", next: {}, chosen: "map" },
          { name: "list", text: "[ ] list", next: [], chosen: "chips" },
          { name: "JSON", text: "JSON", next: [], chosen: "json" },
        ] as const;
        return (
          <div className="flex gap-1.5">
            {choices.map((c) => (
              <button
                key={c.name}
                type="button"
                aria-label={`${label(path)} as ${c.name}`}
                className="rounded border px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
                onClick={() => change(c.next, c.chosen)}
              >
                {c.text}
              </button>
            ))}
          </div>
        );
      }
      return (
        <button
          type="button"
          aria-label={label(path)}
          className="text-[12px] text-muted-foreground hover:text-foreground"
          onClick={() => change(emptyValueFor(type ?? "TEXT"))}
        >
          — (未設定)
        </button>
      );
  }
}
