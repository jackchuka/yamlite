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

function read(key: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

// a set of names kept across reloads in this browser
export function useStoredSet(key: string): [Set<string>, (name: string) => void] {
  const [set, setSet] = useState(() => read(key));
  const toggle = (name: string) => {
    const next = new Set(set);
    if (!next.delete(name)) next.add(name);
    setSet(next);
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      // the change still applies for this session
    }
  };
  return [set, toggle];
}

// the sidebar groups folded away
export const useCollapsedGroups = () => useStoredSet("yamlite-collapsed-groups");

// the tables whose split items are shown
export const useExpandedTables = () => useStoredSet("yamlite-expanded-tables");
