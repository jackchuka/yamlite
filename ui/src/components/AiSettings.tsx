import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type AiChoice, type AiProvider, isRemembered, savedKey } from "@/lib/ai";
import { m } from "@/paraglide/messages.js";

const field = "w-full rounded-md border bg-panel px-2.5 py-1.5 text-[15px]";

export function AiSettings({
  providers,
  initial,
  onSave,
}: {
  providers: AiProvider[];
  initial: AiChoice | null;
  onSave: (c: AiChoice, remember: boolean) => void;
}) {
  const [providerId, setProviderId] = useState(initial?.provider ?? providers[0]?.id ?? "");
  const p = providers.find((x) => x.id === providerId) ?? (providers[0] as AiProvider);
  const [model, setModel] = useState(initial?.provider === p.id ? initial.model : (p.models[0] as string));
  const [apiKey, setApiKey] = useState(initial?.provider === p.id ? initial.apiKey : savedKey(p.id));
  const [remember, setRemember] = useState(isRemembered(p.id));
  const modelId = model.trim();
  const canSave = modelId !== "" && (apiKey.trim() !== "" || p.hasKey);
  return (
    <form
      aria-label={m.agent_settings()}
      className="flex flex-col gap-3 border-b p-3.5 text-[15px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave({ provider: p.id, model: modelId, apiKey: apiKey.trim() }, remember);
      }}
    >
      <label className="flex flex-col gap-1">
        {m.agent_provider()}
        <select
          className={field}
          value={p.id}
          onChange={(e) => {
            const next = providers.find((x) => x.id === e.target.value) as AiProvider;
            setProviderId(next.id);
            setModel(next.models[0] as string);
            setApiKey(savedKey(next.id));
            setRemember(isRemembered(next.id));
          }}
        >
          {providers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        {m.agent_model()}
        <input
          className={field}
          list={`ai-models-${p.id}`}
          autoComplete="off"
          spellCheck={false}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <datalist id={`ai-models-${p.id}`}>
          {p.models.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        {modelId !== "" && !p.models.includes(modelId) && (
          <span className="text-[14px] text-muted-foreground">{m.agent_model_unverified()}</span>
        )}
      </label>
      <label className="flex flex-col gap-1">
        {m.agent_api_key()}
        <input
          className={field}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={p.hasKey ? m.agent_api_key_server() : ""}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <p className="text-[14px] text-muted-foreground">{m.agent_api_key_note()}</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        {m.agent_remember_key()}
      </label>
      <Button type="submit" disabled={!canSave} className="self-end">
        {m.agent_save()}
      </Button>
    </form>
  );
}
