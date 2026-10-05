import { useState } from "react";

export interface Section<T> {
  group: string | null;
  tables: T[];
}

// ungrouped tables first, then each group where its first table is
export function groupTables<T extends { group: string | null }>(tables: T[]): Section<T>[] {
  const sections = new Map<string | null, T[]>([[null, []]]);
  for (const t of tables) {
    const list = sections.get(t.group);
    if (list) list.push(t);
    else sections.set(t.group, [t]);
  }
  return [...sections].filter(([, list]) => list.length > 0).map(([group, list]) => ({ group, tables: list }));
}

export function groupNames(tables: Array<{ group: string | null }>): string[] {
  return [...new Set(tables.flatMap((t) => (t.group === null ? [] : [t.group])))];
}

const KEY = "yamlite-collapsed-groups";

function read(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

// the sidebar groups folded away, kept across reloads
export function useCollapsedGroups(): [Set<string>, (group: string) => void] {
  const [collapsed, setCollapsed] = useState(read);
  const toggle = (group: string) => {
    const next = new Set(collapsed);
    if (!next.delete(group)) next.add(group);
    setCollapsed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      // folding still applies for this session
    }
  };
  return [collapsed, toggle];
}
