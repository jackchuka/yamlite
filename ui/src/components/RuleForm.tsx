import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { fieldLabel, fieldWidth, selectControl } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { boundKind } from "@/lib/rules";
import type { AllowedValue, Bound, ColumnFormat, ColumnType, Rules } from "@/lib/types";
import { m } from "@/paraglide/messages.js";
import { ChipsInput } from "./ChipsInput";

const FORMATS: ColumnFormat[] = ["date", "datetime", "markdown"];

type Setter = <K extends Exclude<keyof Rules, "required">>(
  key: K,
  column: string,
  value: Rules[K][string] | undefined,
) => void;

const own = <T,>(r: Record<string, T>, k: string): T | undefined => (Object.hasOwn(r, k) ? r[k] : undefined);

function parseValue(type: ColumnType, text: string): AllowedValue | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  if (type === "INTEGER" || type === "REAL") {
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "BOOLEAN") return t === "true" ? true : t === "false" ? false : undefined;
  return t;
}

function Field({ title, children, hints = [] }: { title: string; children: ReactNode; hints?: string[] }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className={fieldLabel}>{title}</h4>
      {children}
      <Hints hints={hints} />
    </section>
  );
}

function Hints({ hints }: { hints: string[] }) {
  if (hints.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-[12.5px] text-warn">
      {hints.map((h) => (
        <li key={h}>{h}</li>
      ))}
    </ul>
  );
}

type HintField = "required" | "values" | "references" | "other";

// routed by the checks' wording (src/required.ts, values.ts, references.ts; formats and ranges are the rest)
function hintField(column: string, hint: string): HintField {
  if (hint.includes(`references.${column}: `) || / not found in \S+ \(/.test(hint)) return "references";
  if (hint.includes(`${column} missing (`)) return "required";
  if (hint.includes(" not in values (")) return "values";
  return "other";
}

export function RuleForm({
  column,
  type,
  draft,
  tables,
  hints,
  set,
  toggleRequired,
  onBack,
}: {
  column: string;
  type: ColumnType;
  draft: Rules;
  tables: string[];
  hints: string[];
  set: Setter;
  toggleRequired: (column: string, on: boolean) => void;
  // on a phone: back to the column list
  onBack?: () => void;
}) {
  const format = own(draft.formats, column);
  const values = own(draft.values, column) ?? [];
  const kind = boundKind(type, format);
  const ref = own(draft.references, column) ?? "";
  const dot = ref.indexOf(".");
  const refTable = dot < 0 ? ref : ref.slice(0, dot);
  const refColumn = dot < 0 ? "" : ref.slice(dot + 1);
  const hintsOf = (field: HintField) => hints.filter((h) => hintField(column, h) === field);
  const showValues = format !== "markdown";

  // chips are the values as text; a chip already there keeps its value
  const setValues = (texts: string[]) => {
    const next = [
      ...new Set(texts.map((t) => values.find((v) => String(v) === t) ?? (parseValue(type, t) as AllowedValue))),
    ];
    set("values", column, next.length === 0 ? undefined : next);
  };
  const setFormat = (next: ColumnFormat | undefined) => {
    set("formats", column, next);
    if (next === "markdown") set("values", column, undefined);
    if (boundKind(type, next) !== kind) {
      set("min", column, undefined);
      set("max", column, undefined);
    }
  };
  const setBound = (key: "min" | "max", text: string) => {
    const value: Bound | undefined = text === "" ? undefined : kind === "number" ? Number(text) : text;
    set(key, column, value !== undefined && typeof value === "number" && !Number.isFinite(value) ? undefined : value);
  };
  const setRef = (table: string, col: string) =>
    set("references", column, table === "" ? undefined : col.trim() === "" ? table : `${table}.${col.trim()}`);

  return (
    <div className="flex flex-col gap-5 text-[13px]">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
              {`‹ ${m.rules_back()}`}
            </Button>
          )}
          <h3 className="font-mono text-[15px] font-semibold">{column}</h3>
        </div>
        <p className="text-muted-foreground">{m.rules_type_fixed({ type })}</p>
      </div>
      <Field title={m.rules_required()} hints={hintsOf("required")}>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label={m.rules_required()}
            className="size-4"
            checked={draft.required.includes(column)}
            onChange={(e) => toggleRequired(column, e.target.checked)}
          />
          <span>{m.rules_required_hint()}</span>
        </label>
      </Field>
      {showValues && (
        <Field title={m.rules_values()} hints={hintsOf("values")}>
          <ChipsInput
            label={m.rules_values()}
            value={values.map(String)}
            onChange={setValues}
            placeholder={m.rules_values_placeholder()}
            removeLabel={(value) => m.rules_remove_value({ value })}
            accept={(t) => parseValue(type, t) !== undefined}
            unique
          />
        </Field>
      )}
      {type === "TEXT" && (
        <Field title={m.rules_format()}>
          <select
            aria-label={m.rules_format()}
            className={`${selectControl} ${fieldWidth}`}
            value={format ?? ""}
            onChange={(e) => setFormat(e.target.value === "" ? undefined : (e.target.value as ColumnFormat))}
          >
            <option value="">{m.rules_none()}</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
      )}
      {kind && (
        <div className="flex flex-wrap gap-3 max-md:flex-col">
          {(["min", "max"] as const).map((key) => (
            <Field key={key} title={key === "min" ? m.rules_min() : m.rules_max()}>
              <Input
                aria-label={key === "min" ? m.rules_min() : m.rules_max()}
                type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
                className={fieldWidth}
                value={String(own(draft[key], column) ?? "")}
                onChange={(e) => setBound(key, e.target.value)}
              />
            </Field>
          ))}
        </div>
      )}
      <Hints hints={showValues ? hintsOf("other") : [...hintsOf("values"), ...hintsOf("other")]} />
      <Field title={m.rules_reference()} hints={hintsOf("references")}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={m.rules_reference()}
            className={`${selectControl} ${fieldWidth}`}
            value={refTable}
            onChange={(e) => setRef(e.target.value, "")}
          >
            <option value="">{m.rules_none()}</option>
            {tables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Input
            aria-label={m.rules_reference_column()}
            placeholder={m.rules_reference_column_placeholder()}
            className={`${fieldWidth} font-mono`}
            disabled={refTable === ""}
            value={refColumn}
            onChange={(e) => setRef(refTable, e.target.value)}
          />
        </div>
      </Field>
    </div>
  );
}
