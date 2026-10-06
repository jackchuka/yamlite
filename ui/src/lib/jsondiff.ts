export interface JsonChange {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isPrimitive = (v: unknown) => v === null || typeof v !== "object";
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : isObj(v)
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
          .join(",")}}`
      : (JSON.stringify(v) ?? "null");

const join = (path: string, seg: string) => (path === "" ? seg : `${path} › ${seg}`);
const PREFERRED = ["id", "key", "name"];

const NAME_LIKE = /(^|_)(id|key|code|uuid|slug|name)$/i;
const ID_LIKE = /^[\w.\-:/]{1,64}$/;
export const MAX_LCS_CELLS = 2000 * 2000;

function plainIdentity(v: unknown) {
  if (typeof v === "string") return v.length <= 64 && !/\s/.test(v);
  return typeof v === "number" || typeof v === "boolean";
}

function identityField(a: Obj[], b: Obj[]): string | null {
  const all = [...a, ...b];
  if (all.length === 0) return null;
  const valid = (k: string) =>
    all.every((o) => Object.hasOwn(o, k) && plainIdentity(o[k])) &&
    new Set(all.map((o) => typeof o[k])).size === 1 &&
    [a, b].every((list) => new Set(list.map((o) => o[k])).size === list.length);
  const overlap = (k: string) => {
    if (a.length === 0 || b.length === 0) return 1;
    const inB = new Set(b.map((o) => o[k]));
    return a.filter((o) => inB.has(o[k])).length;
  };
  const preferred = PREFERRED.find((k) => valid(k) && overlap(k) > 0);
  if (preferred) return preferred;
  const need = Math.ceil(Math.min(a.length, b.length) / 2);
  const rest = Object.keys(all[0]!).filter(
    (k) => !PREFERRED.includes(k) && valid(k) && overlap(k) >= Math.max(need, 1),
  );
  const idLike = (k: string) => all.every((o) => typeof o[k] !== "string" || ID_LIKE.test(o[k]));
  return (
    rest.find((k) => NAME_LIKE.test(k)) ??
    rest.find((k) => idLike(k) && all.every((o) => typeof o[k] === "string" || Number.isInteger(o[k]))) ??
    null
  );
}

function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const dp = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function diffArrays(a: unknown[], b: unknown[], path: string, out: JsonChange[]) {
  if (a.every(isObj) && b.every(isObj)) {
    const field = identityField(a as Obj[], b as Obj[]);
    if (field !== null) {
      const index = (list: unknown[]) => new Map((list as Obj[]).map((o) => [String(o[field]), o]));
      const before = index(a);
      const after = index(b);
      for (const [id, o] of before) {
        const next = after.get(id);
        const p = join(path, id);
        if (next === undefined) out.push({ path: p, kind: "removed", before: o });
        else walk(o, next, p, out);
      }
      for (const [id, o] of after) if (!before.has(id)) out.push({ path: join(path, id), kind: "added", after: o });
      return;
    }
  }
  if (a.length === b.length) {
    a.forEach((x, i) => walk(x, b[i], join(path, `[${i}]`), out));
    return;
  }
  const ca = a.map(canon);
  const cb = b.map(canon);
  let start = 0;
  while (start < ca.length && start < cb.length && ca[start] === cb[start]) start++;
  let endA = ca.length;
  let endB = cb.length;
  while (endA > start && endB > start && ca[endA - 1] === cb[endB - 1]) {
    endA--;
    endB--;
  }
  if ((endA - start) * (endB - start) > MAX_LCS_CELLS) {
    out.push({ path, kind: "changed", before: a, after: b });
    return;
  }
  const pairs = lcsPairs(ca.slice(start, endA), cb.slice(start, endB));
  const keptA = new Set(pairs.map(([i]) => i + start));
  const keptB = new Set(pairs.map(([, j]) => j + start));
  for (let i = start; i < endA; i++)
    if (!keptA.has(i)) out.push({ path: join(path, `[${i}]`), kind: "removed", before: a[i] });
  for (let j = start; j < endB; j++)
    if (!keptB.has(j)) out.push({ path: join(path, `[${j}]`), kind: "added", after: b[j] });
}

function walk(a: unknown, b: unknown, path: string, out: JsonChange[]) {
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) {
      if (!Object.hasOwn(b, k)) out.push({ path: join(path, k), kind: "removed", before: a[k] });
      else walk(a[k], b[k], join(path, k), out);
    }
    for (const k of Object.keys(b))
      if (!Object.hasOwn(a, k)) out.push({ path: join(path, k), kind: "added", after: b[k] });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && !(a.every(isPrimitive) && b.every(isPrimitive))) {
    diffArrays(a, b, path, out);
    return;
  }
  if (canon(a) !== canon(b)) out.push({ path, kind: "changed", before: a, after: b });
}

export function diffJson(before: unknown, after: unknown): JsonChange[] {
  const out: JsonChange[] = [];
  walk(before, after, "", out);
  return out;
}

export const isStructured = (v: unknown) => typeof v === "object" && v !== null;
