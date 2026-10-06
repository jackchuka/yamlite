import { useState } from "react";

export const MIN_COLUMN_WIDTH = 60;

export interface GridPrefs {
  // px, for columns the viewer has resized
  widths: Record<string, number>;
  unpinned: boolean;
}

const storageKey = (table: string) => `yamlite-grid:${table}`;

function read(table: string): GridPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(table)) ?? "{}") as Partial<GridPrefs>;
    const widths = Object.fromEntries(
      Object.entries(raw.widths ?? {}).filter(([, w]) => typeof w === "number" && Number.isFinite(w)),
    );
    return { widths, unpinned: raw.unpinned === true };
  } catch {
    return { widths: {}, unpinned: false };
  }
}

// column widths and whether the key column stays in place, per table, kept across reloads
export function useGridPrefs(table: string) {
  const [prefs, setPrefs] = useState(() => read(table));
  const save = (next: GridPrefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(storageKey(table), JSON.stringify(next));
    } catch {
      // still applies for this session
    }
  };
  return {
    ...prefs,
    // null puts the column back to its default width
    setWidth: (column: string, width: number | null) => {
      const { [column]: _, ...rest } = prefs.widths;
      save({
        ...prefs,
        widths: width === null ? rest : { ...rest, [column]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)) },
      });
    },
    togglePin: () => save({ ...prefs, unpinned: !prefs.unpinned }),
  };
}
