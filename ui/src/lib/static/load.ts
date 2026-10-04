import type { Api } from "../api";
import type { Snapshot, YamlMap } from "../types";
import { createStaticApi } from "./api";

export class LoadError extends Error {
  constructor(
    readonly file: string,
    reason: string,
  ) {
    super(`${file}: ${reason}`);
  }
}

async function fetchOk(base: string, file: string, fetcher: typeof fetch): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(new URL(file, base).toString());
  } catch (e) {
    throw new LoadError(file, e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new LoadError(file, `${res.status} ${res.statusText}`.trim());
  return res;
}

export function buildYamlLoader(base: string, fetcher: typeof fetch): (table: string) => Promise<YamlMap> {
  const cache = new Map<string, Promise<YamlMap>>();
  return (table) => {
    let p = cache.get(table);
    if (!p) {
      p = fetchOk(base, `data/yaml/${encodeURIComponent(table)}.json`, fetcher).then(
        (r) => r.json() as Promise<YamlMap>,
      );
      // a failed load is retried the next time the record opens
      p.catch(() => cache.delete(table));
      cache.set(table, p);
    }
    return p;
  };
}

export function buildPageLoader(base: string, fetcher: typeof fetch): (name: string) => Promise<string> {
  return async (name) => (await fetchOk(base, `data/pages/${encodeURIComponent(name)}.html`, fetcher)).text();
}

export async function loadStatic(
  opts: { base?: string; fetcher?: typeof fetch } = {},
): Promise<{ api: Api; snapshot: Snapshot }> {
  const base = opts.base ?? document.baseURI;
  const fetcher = opts.fetcher ?? fetch;
  // the data first: a missing file is the likelier failure and should not wait for the WASM
  const snapshot = (await (await fetchOk(base, "data/snapshot.json", fetcher)).json()) as Snapshot;
  const bytes = new Uint8Array(await (await fetchOk(base, "data/db.sqlite", fetcher)).arrayBuffer());
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import("sql.js"),
    import("sql.js/dist/sql-wasm.wasm?url"),
  ]);
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;
  try {
    SQL = await initSqlJs({ locateFile: () => wasmUrl });
  } catch (e) {
    throw new LoadError("sql-wasm.wasm", e instanceof Error ? e.message : String(e));
  }
  const db = new SQL.Database(bytes);
  return {
    api: createStaticApi({
      db,
      snapshot,
      loadYaml: buildYamlLoader(base, fetcher),
      loadPage: buildPageLoader(base, fetcher),
    }),
    snapshot,
  };
}
