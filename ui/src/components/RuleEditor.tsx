import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { dialogBar } from "@/components/ui/dialog";
import { SectionCard } from "@/components/ui/section-card";
import { api, ApiError } from "@/lib/api";
import { useMeta } from "@/lib/providers";
import { columnRules, indexEditOf, ruleSummary, sameIndexes, sameSet, warningsFor } from "@/lib/rules";
import type { ColumnType, IndexEdit, IndexInfo, RuleTarget, Rules, RulesPreview, SchemaEdit } from "@/lib/types";
import { useDebounced } from "@/lib/useDebounced";
import { useIsMobile } from "@/lib/useIsMobile";
import { m } from "@/paraglide/messages.js";
import { IndexEditor } from "./IndexEditor";
import { RuleForm } from "./RuleForm";
import { ViewEditor } from "./ViewEditor";

type Props = {
  target: RuleTarget;
  // set for an expanded view
  viewName?: string;
  columns: Record<string, ColumnType>;
  // key / identity columns: listed, not editable
  fixed: string[];
  initial: Rules;
  base: string;
  // a table's indexes; absent for a view
  indexes?: IndexInfo[];
  // the views under the target, nested ones included
  views: { name: string; path: string[] }[];
  onOpenView: (name: string) => void;
  // saved or cancelled
  onDone: () => void;
  // a view's table and ancestor views, outermost first; the view itself is here
  trail?: { label: string; onOpen: () => void }[];
  here?: string;
  // where the dialog pins the preview and Save; null until it mounts, absent to render them in place
  footer?: HTMLElement | null;
};

// a stale base answers with the current one; other 409s (e.g. git steps running) are plain errors
const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409 && "current" in e.body;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Draft = { rules: Rules; indexes: IndexEdit[]; views: string[] };

export function RuleEditor(p: Props) {
  const queryClient = useQueryClient();
  const { data: meta } = useMeta();
  const mobile = useIsMobile();
  const names = Object.keys(p.columns);
  const [selected, setSelected] = useState<string | null>(() =>
    mobile ? null : (names.find((c) => !p.fixed.includes(c)) ?? null),
  );
  // pinned when editing starts: a refetched schema must not move it under the draft
  const [base] = useState(p.base);
  const children = p.views.filter((v) => v.path.length === p.target.path.length + 1);
  const [start] = useState<Draft>(() => ({
    rules: p.initial,
    indexes: (p.indexes ?? []).map(indexEditOf),
    views: children.map((v) => v.path.at(-1) as string),
  }));
  const [edit, setEdit] = useState<Draft>(start);
  const draft = edit.rules;
  const setDraft = (f: (d: Rules) => Rules) => setEdit((e) => ({ ...e, rules: f(e.rules) }));
  const [preview, setPreview] = useState<RulesPreview | null>(null);
  const [previewed, setPreviewed] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const debounced = useDebounced(edit, 300);

  // indexes and views go only when they differ from where editing started
  const changesOf = (d: Draft): SchemaEdit => ({
    ...(p.indexes !== undefined && !sameIndexes(d.indexes, start.indexes) ? { indexes: d.indexes } : {}),
    ...(!sameSet(d.views, start.views) ? { views: d.views } : {}),
  });

  const dirty = JSON.stringify(edit.rules) !== JSON.stringify(start.rules) || Object.keys(changesOf(edit)).length > 0;
  const leave = (go: () => void) => {
    if (dirty && !window.confirm(m.rules_discard_confirm())) return;
    go();
  };
  const openView = (name: string) => leave(() => p.onOpenView(name));
  // a view removed in the draft takes the views under it along
  const linked = p.views.filter((v) => edit.views.includes(v.path[p.target.path.length] as string));

  useEffect(() => {
    let live = true;
    api.previewRules(p.target, debounced.rules, base, changesOf(debounced)).then(
      (r) => {
        if (!live) return;
        setPreview(r);
        setPreviewed(debounced);
        setError(null);
      },
      (e: unknown) => {
        if (!live) return;
        if (isConflict(e)) setConflict(true);
        else setError(message(e));
      },
    );
    return () => {
      live = false;
    };
  }, [debounced, base, p.target]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["schema"] });
    void queryClient.invalidateQueries({ queryKey: ["meta"] });
  };

  const save = useMutation({
    mutationFn: () => api.saveRules(p.target, edit.rules, base, changesOf(edit)),
    onSuccess: () => {
      refresh();
      p.onDone();
    },
    onError: (e) => (isConflict(e) ? setConflict(true) : setError(message(e))),
  });

  const set = <K extends Exclude<keyof Rules, "required">>(
    key: K,
    column: string,
    value: Rules[K][string] | undefined,
  ) =>
    setDraft((d) => {
      const next = { ...d[key] } as Record<string, unknown>;
      if (value === undefined) delete next[column];
      else next[column] = value;
      return { ...d, [key]: next };
    });
  const toggleRequired = (column: string, on: boolean) =>
    setDraft((d) => ({
      ...d,
      required: on ? [...d.required.filter((c) => c !== column), column] : d.required.filter((c) => c !== column),
    }));

  const loadLatest = () => {
    if (!window.confirm(m.rules_discard_confirm())) return;
    refresh();
    p.onDone();
  };

  const added = preview?.added ?? [];
  const removed = preview?.removed ?? [];
  const indexChanges = [
    ...(preview?.indexes?.added ?? []).map((index) => m.rules_index_added({ index })),
    ...(preview?.indexes?.removed ?? []).map((index) => m.rules_index_removed({ index })),
  ];
  const type = selected === null ? undefined : p.columns[selected];

  const list = (
    <nav className="flex flex-col gap-1">
      {names.map((name) => {
        const fixed = p.fixed.includes(name);
        const summary = ruleSummary(draft, name);
        const changed = !fixed && columnRules(draft, name) !== columnRules(start.rules, name);
        const current = selected === name;
        return (
          <button
            key={name}
            type="button"
            disabled={fixed}
            aria-current={current || undefined}
            onClick={() => setSelected(name)}
            className={`flex flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left disabled:cursor-default ${current ? "bg-accent" : "hover:bg-background disabled:hover:bg-transparent"}`}
          >
            <span className={`font-mono text-[13px] ${current ? "font-semibold" : ""}`}>{name}</span>
            {(fixed || summary.length > 0 || changed) && (
              <span className="text-[12px] text-muted-foreground">
                {fixed ? m.rules_fixed() : summary.join(" · ")}
                {changed && (
                  <span className="text-tomato">{`${summary.length > 0 ? " · " : ""}${m.rules_changed()}`}</span>
                )}
              </span>
            )}
          </button>
        );
      })}
      {linked.map((v) => (
        <button
          key={v.name}
          type="button"
          onClick={() => openView(v.name)}
          className="rounded-md px-3 py-2 text-left font-mono text-[13px] hover:bg-background"
        >
          {`${v.name} ▸`}
        </button>
      ))}
    </nav>
  );

  const form = selected !== null && type !== undefined && (
    <div className="flex flex-col gap-3">
      <RuleForm
        key={selected}
        column={selected}
        type={type}
        draft={draft}
        tables={(meta?.tables ?? []).map((t) => t.name)}
        hints={warningsFor(selected, added, p.viewName)}
        set={set}
        toggleRequired={toggleRequired}
        onBack={mobile ? () => setSelected(null) : undefined}
      />
    </div>
  );

  const bar = (
    <footer
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] ${p.footer === undefined ? "border-t pt-3" : dialogBar}`}
    >
      {conflict && (
        <div className="flex w-full flex-wrap items-center gap-3 text-warn">
          <span>{m.rules_conflict()}</span>
          <Button type="button" variant="outline" onClick={loadLatest}>
            {m.rules_load_latest()}
          </Button>
        </div>
      )}
      {preview && (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {added.length > 0 && <p className="text-warn">{m.rules_added({ count: added.length })}</p>}
          {removed.length > 0 && <p className="text-ok">{m.rules_removed({ count: removed.length })}</p>}
          {indexChanges.map((line) => (
            <p key={line} className="font-mono">
              {line}
            </p>
          ))}
          {!preview.changed && <p className="text-muted-foreground">{m.rules_no_change()}</p>}
          {added.length > 0 && (
            <ul className="max-h-24 list-disc overflow-y-auto pl-5 text-[12.5px] text-muted-foreground">
              {added.slice(0, 5).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error !== null && <p className="w-full text-err">{error}</p>}
      <div className="ml-auto flex shrink-0 justify-end gap-2">
        <Button type="button" variant="outline" onClick={p.onDone}>
          {m.rules_cancel()}
        </Button>
        <Button
          type="button"
          disabled={!preview?.changed || previewed !== edit || error !== null || conflict || save.isPending}
          onClick={() => save.mutate()}
        >
          {m.rules_save()}
        </Button>
      </div>
    </footer>
  );

  const crumbs = p.trail && p.trail.length > 0 && (
    <>
      <span aria-hidden className="text-muted-foreground">
        {"·"}
      </span>
      <nav aria-label={m.rules_breadcrumb()} className="flex flex-wrap items-center gap-x-1 gap-y-1 font-mono">
        {p.trail.map((c) => (
          <span key={c.label} className="flex items-center gap-1">
            <button
              type="button"
              aria-label={m.rules_back_to({ name: c.label })}
              className="rounded-md px-1.5 py-0.5 text-muted-foreground underline-offset-2 hover:bg-background hover:text-foreground hover:underline"
              onClick={() => leave(c.onOpen)}
            >
              {c.label}
            </button>
            <span aria-hidden className="text-muted-foreground">
              {"›"}
            </span>
          </span>
        ))}
        <span className="px-1.5 font-semibold" title={p.viewName}>
          {p.here}
        </span>
      </nav>
    </>
  );

  const listPane = <div className="bg-muted p-2">{list}</div>;
  const formPane = form && <div className="px-4 py-4">{form}</div>;

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <SectionCard title={m.schema_columns()} heading={crumbs} flush>
        {mobile ? (
          formPane || listPane
        ) : (
          <div className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <div className="border-r bg-muted p-2">{list}</div>
            {formPane || <div />}
          </div>
        )}
      </SectionCard>
      {p.indexes !== undefined && (
        <IndexEditor
          indexes={edit.indexes}
          known={p.indexes}
          columns={names}
          onChange={(indexes) => setEdit((e) => ({ ...e, indexes }))}
        />
      )}
      <ViewEditor
        fields={edit.views}
        names={Object.fromEntries(children.map((v) => [v.path.at(-1) as string, v.name]))}
        json={names.filter((c) => p.columns[c] === "JSON")}
        onChange={(views) => setEdit((e) => ({ ...e, views }))}
      />
      {p.footer === undefined ? bar : p.footer && createPortal(bar, p.footer)}
    </div>
  );
}
