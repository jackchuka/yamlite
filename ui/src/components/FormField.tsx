import { json } from "@codemirror/lang-json";
import { useQuery } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { ArrowUpRight, Calendar, Clock, Type, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { parseDatetime } from "../../../src/datetime.ts";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { fromPicker, localOffset, pickerBound, toPicker } from "@/lib/datetime";
import { emptyValueFor, fieldKind, fieldProblem } from "@/lib/form";
import { useTheme } from "@/lib/theme";
import type { AllowedValue, Bound, ColumnFormat, ColumnType, Reference } from "@/lib/types";
import { RefLink } from "./RefLink";
import { m } from "@/paraglide/messages.js";

export interface FieldProps {
  path: Array<string | number>;
  value: unknown;
  type?: ColumnType;
  format?: ColumnFormat;
  // a markdown field read from an .mdx file: the preview shows its JSX and ESM
  mdx?: boolean;
  reference?: Reference;
  // the column's declared values: edited with a select, a value outside the list kept and marked
  allowed?: AllowedValue[];
  // the column's bounds: shown as a warning when the value is outside them, never enforced
  min?: Bound;
  max?: Bound;
  // the value breaks its format or bounds: the input is drawn with a warning border
  problem?: boolean;
  onChange: (next: unknown) => void;
  onRemove?: () => void;
  onValidity?: (path: string, ok: boolean) => void;
  readOnly?: boolean;
}

const label = (path: Array<string | number>) => path.join(".");

// the markdown parsers are large; load them only when a markdown field shows up
const MarkdownField = lazy(() => import("./MarkdownField"));

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
          className="inline-flex items-center rounded-full bg-chip pl-2 pr-1 text-[11.5px] text-chip-foreground max-md:py-0.5 max-md:text-[13px]"
        >
          {chip}
          <button
            type="button"
            aria-label={m.form_remove({ item: chip })}
            className="ml-1 opacity-60 max-md:grid max-md:size-7 max-md:place-items-center"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label={label(path)}
        className="min-w-16 flex-1 bg-transparent px-1 outline-none"
        placeholder={m.form_add_placeholder()}
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
      <button
        type="button"
        aria-label={m.form_add_to({ field: label(path) })}
        className="rounded-md px-2 text-[13px] text-muted-foreground md:hidden"
        // keeps focus in the input, so its blur does not add the chip first
        onMouseDown={(e) => e.preventDefault()}
        onClick={add}
      >
        {m.form_add()}
      </button>
    </div>
  );
}

function JsonField({ path, value, onChange, onValidity, readOnly }: FieldProps) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  const theme = useTheme();
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
        extensions={[json(), EditorView.lineWrapping]}
        theme={theme}
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

// as a BOOLEAN column stores it, so that false matches 0 and true matches 1
const asText = (v: unknown) => (v === true ? "1" : v === false ? "0" : v == null ? "" : String(v));

function ValuesField({ path, value, allowed, onChange, readOnly }: FieldProps & { allowed: AllowedValue[] }) {
  const current = asText(value);
  const outside = current !== "" && !allowed.some((a) => asText(a) === current);
  return (
    <select
      aria-label={label(path)}
      aria-invalid={outside || undefined}
      disabled={readOnly}
      className={`h-9 w-full rounded-md border bg-background px-2 text-sm ${outside ? "border-warn text-warn" : ""}`}
      value={current}
      onChange={(e) => {
        const next = e.target.value;
        if (next === "") return onChange(null);
        const hit = allowed.find((a) => asText(a) === next);
        if (hit !== undefined) onChange(hit);
      }}
    >
      <option value="">—</option>
      {outside && <option value={current}>{`${current} (not in values)`}</option>}
      {allowed.map((a, i) => (
        <option key={`${i}:${asText(a)}`} value={asText(a)}>
          {String(a)}
        </option>
      ))}
    </select>
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
  const text = value == null ? "" : String(value);
  return (
    <>
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={label(path)}
          list={listId}
          value={text}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
        {reference && text !== "" && (
          <RefLink
            reference={reference}
            value={text}
            className="shrink-0 text-muted-foreground hover:text-foreground max-md:grid max-md:size-9 max-md:place-items-center max-md:text-foreground"
          >
            <ArrowUpRight className="size-4" />
          </RefLink>
        )}
      </div>
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
          <span className="pt-1.5 font-mono text-[11px] text-syn-key max-md:text-[12.5px]">{k}</span>
          <FormField
            {...props}
            path={[...path, k]}
            value={v}
            type={undefined}
            format={undefined}
            min={undefined}
            max={undefined}
            reference={undefined}
            onChange={(next) => onChange({ ...(value as object), [k]: next })}
          />
          <button
            type="button"
            aria-label={m.form_remove({ item: label([...path, k]) })}
            className="pt-1.5 text-muted-foreground max-md:grid max-md:size-8 max-md:place-items-center max-md:pt-0"
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
        <button
          type="button"
          className="pb-2 text-[11.5px] text-muted-foreground max-md:py-2 max-md:text-[13px]"
          onClick={() => setNewKey("")}
        >
          {m.form_new_key()}
        </button>
      ) : (
        <Input
          autoFocus
          aria-label={m.form_new_key_in({ field: label(path) })}
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

const warnBorder = (problem?: boolean) => (problem ? "border-warn" : "");

function DateField({ path, value, min, max, problem, onChange }: FieldProps) {
  return (
    <Input
      type="date"
      aria-label={label(path)}
      className={`w-44 font-mono max-md:w-full ${warnBorder(problem)}`}
      value={typeof value === "string" ? value : ""}
      min={typeof min === "string" ? min : undefined}
      max={typeof max === "string" ? max : undefined}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
    />
  );
}

// the picker edits the time; the offset, separator and seconds stay as the value spells them
function DatetimeField({ path, value, min, max, problem, onChange }: FieldProps) {
  const text = typeof value === "string" ? value : "";
  const picker = text === "" ? null : toPicker(text);
  const offset = parseDatetime(text)?.offset ?? null;
  // bounds are read in the offset the picker shows: the value's, else the browser's for a new value, else UTC
  const boundOffset = text === "" ? localOffset(new Date().toISOString().slice(0, 10), "12", "00") : offset;
  // a cleared segment empties the picker for a moment; the spelling to keep is the last one it had
  const last = useRef(text);
  if (text !== "") last.current = text;
  return (
    <div className="flex items-center gap-1.5 max-md:flex-wrap">
      <Input
        type="datetime-local"
        aria-label={label(path)}
        className={`w-60 font-mono max-md:w-full ${warnBorder(problem)}`}
        step={picker?.step ?? 60}
        value={picker?.value ?? ""}
        min={pickerBound(min, boundOffset)}
        max={pickerBound(max, boundOffset)}
        onChange={(e) => {
          if (e.target.value === "") return onChange(null);
          const next = fromPicker(e.target.value, last.current === "" ? null : last.current);
          if (next !== null) onChange(next);
        }}
      />
      {offset && <span className="font-mono text-[12px] text-muted-foreground">{offset}</span>}
    </div>
  );
}

const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

// the widget is chosen once per mount so typing never swaps it; the parent remounts on reload
function Widget(props: FieldProps) {
  const { path, value, type, format, reference, problem, onChange } = props;
  const dated = format === "date" || format === "datetime";
  const [kind, setKind] = useState(() => fieldKind(value, type, reference !== undefined, format));
  const [numText, setNumText] = useState(value == null ? "" : String(value));
  const text = value == null ? "" : String(value);
  const change = (next: unknown, chosen?: typeof kind) => {
    if (kind === "unset") {
      setKind(chosen ?? fieldKind(next, type, false, format));
      setNumText(next == null ? "" : String(next));
    }
    onChange(next);
  };
  const toggle = (to: "text" | "picker") => (
    <button
      type="button"
      aria-label={m.form_as({ field: label(path), kind: to })}
      className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground hover:text-foreground max-md:grid max-md:min-h-8 max-md:min-w-8 max-md:place-items-center"
      onClick={() => setKind(to === "text" ? "text" : fieldKind(value, type, false, format))}
    >
      {to === "text" ? (
        <Type className="size-3.5" />
      ) : format === "date" ? (
        <Calendar className="size-3.5" />
      ) : (
        <Clock className="size-3.5" />
      )}
    </button>
  );
  if (props.allowed && type !== "JSON") return <ValuesField {...props} allowed={props.allowed} />;
  switch (kind) {
    case "switch":
      return <Switch aria-label={label(path)} checked={value === true} onCheckedChange={change} />;
    case "number":
    case "bigint":
      return (
        <Input
          aria-label={label(path)}
          inputMode={type === "REAL" ? "decimal" : "numeric"}
          className={`w-40 font-mono max-md:w-full ${warnBorder(problem)}`}
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
    case "date":
    case "datetime":
      return (
        <div className="flex items-center gap-1.5">
          {kind === "date" ? <DateField {...props} /> : <DatetimeField {...props} />}
          {toggle("text")}
        </div>
      );
    case "text": {
      const input = (
        <Input
          aria-label={label(path)}
          className={warnBorder(problem)}
          value={text}
          onChange={(e) => change(dated && e.target.value === "" ? null : e.target.value)}
        />
      );
      if (!dated) return input;
      const canPick = fieldKind(value, type, false, format) === format;
      return (
        <div className="flex items-center gap-1.5">
          {input}
          {canPick && toggle("picker")}
        </div>
      );
    }
    case "textarea":
      return (
        <Textarea
          aria-label={label(path)}
          className={warnBorder(problem)}
          rows={4}
          value={text}
          onChange={(e) => change(e.target.value)}
        />
      );
    case "markdown":
      return (
        <Suspense fallback={<Textarea aria-label={label(path)} rows={4} value={text} readOnly />}>
          <MarkdownField {...props} />
        </Suspense>
      );
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
                aria-label={m.form_as({ field: label(path), kind: c.name })}
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
          {m.form_unset()}
        </button>
      );
  }
}

export function FormField(props: FieldProps) {
  const problem = fieldProblem(props.value, props.format, props.min, props.max);
  return (
    <div data-problem={problem ?? undefined}>
      <Widget {...props} problem={problem !== null} />
      {problem && <p className="mt-1 text-[11px] text-warn">{problem}</p>}
    </div>
  );
}
