import type { QueryKey } from "@tanstack/react-query";
import type { ServeEvent } from "./types";

export function invalidationsFor(e: ServeEvent | { type: "hello" }): QueryKey[] {
  switch (e.type) {
    case "hello":
      // reconnected: anything may have changed while the stream was down
      return [[]];
    case "sync":
      if (e.changes.length === 0 && e.schema.length === 0) return [];
      return [
        ["rows", e.table],
        ["record", e.table],
        ["history", e.table],
        ["refKeys", e.table],
        ["schema"],
        ["meta"],
        ["git"],
        ["gitdiff"],
      ];
    case "reload":
      return [["meta"], ["page"]];
    case "page":
      return e.pages.map((name) => ["page", name]);
    case "conflict":
      return [["conflicts"]];
    case "error":
      return [];
  }
}
