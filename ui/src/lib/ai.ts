import { isReadOnly } from "./mode";
import { useMeta } from "./providers";

export interface AiProvider {
  id: string;
  name: string;
  models: string[];
  hasKey: boolean;
}

export interface AiChoice {
  provider: string;
  model: string;
  apiKey: string;
}

const KEY = "yamlite-ai";

interface Saved {
  provider?: string;
  model?: string;
  keys?: Record<string, string>;
}

// keys the viewer chose not to remember last as long as the tab
const unsaved: Record<string, string> = {};

function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

function store(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function useAiProviders(): AiProvider[] | null {
  const meta = useMeta();
  return isReadOnly() ? null : (meta.data?.ai?.providers ?? null);
}

export function useAiHost(): { viewerKeys: boolean; settingsUrl: string | null } | null {
  const meta = useMeta();
  const ai = isReadOnly() ? null : meta.data?.ai;
  return ai ? { viewerKeys: ai.viewerKeys, settingsUrl: ai.settingsUrl } : null;
}

export function savedKey(providerId: string): string {
  return unsaved[providerId] ?? load().keys?.[providerId] ?? "";
}

export function isRemembered(providerId: string): boolean {
  return !!load().keys?.[providerId];
}

export function currentChoice(
  providers: AiProvider[],
  { viewerKeys }: { viewerKeys: boolean } = { viewerKeys: true },
): AiChoice | null {
  const s = load();
  const p = providers.find((x) => x.id === s.provider) ?? providers.find((x) => x.hasKey) ?? providers[0];
  if (!p) return null;
  const saved = p.id === s.provider && s.model ? s.model : undefined;
  const model = saved && (viewerKeys || p.models.includes(saved)) ? saved : (p.models[0] as string);
  const apiKey = viewerKeys ? savedKey(p.id) : "";
  return apiKey || p.hasKey ? { provider: p.id, model, apiKey } : null;
}

export function saveChoice(c: AiChoice, remember: boolean): void {
  const keys = { ...load().keys };
  delete keys[c.provider];
  delete unsaved[c.provider];
  if (c.apiKey) {
    if (remember) keys[c.provider] = c.apiKey;
    else unsaved[c.provider] = c.apiKey;
  }
  store({ provider: c.provider, model: c.model, keys });
}
