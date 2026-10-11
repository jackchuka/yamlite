import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { defaultFilter } from "cmdk";
import { api } from "./api";
import type { SearchHit } from "./types";

export const MIN_QUERY = 2;
const AROUND = 30;

export const enoughText = (needle: string): boolean => [...needle.trim()].length >= MIN_QUERY;

export interface SnippetParts {
  before: string;
  match: string;
  after: string;
}

// markdown bodies read as prose: line-leading heading, list and quote markers go, whitespace collapses
const flat = (s: string) => s.replace(/^[ \t]*(?:#{1,6}|[-*+]|>)[ \t]+/gm, "").replace(/\s+/g, " ");

// located on the raw value so collapsing whitespace cannot move the match
export function snippet(value: string, needle: string, around = AROUND): SnippetParts {
  const at = value.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) {
    const head = value.slice(0, around * 2);
    return { before: "", match: "", after: flat(head) + (value.length > head.length ? "…" : "") };
  }
  const end = at + needle.length;
  const start = Math.max(0, at - around);
  const stop = Math.min(value.length, end + around);
  return {
    before: (start > 0 ? "…" : "") + flat(value.slice(start, at)),
    match: flat(value.slice(at, end)),
    after: flat(value.slice(end, stop)) + (stop < value.length ? "…" : ""),
  };
}

// SQL ranks by how the key matches; cmdk's fuzzy score only breaks ties within a rank
export function rankHits(hits: SearchHit[], needle: string): SearchHit[] {
  const score = new Map(hits.map((h) => [h, defaultFilter(h.value, needle)]));
  return [...hits].sort(
    (a, b) =>
      a.rank - b.rank ||
      (score.get(b) ?? 0) - (score.get(a) ?? 0) ||
      a.table.localeCompare(b.table) ||
      a.key.localeCompare(b.key),
  );
}

export interface TableHits {
  table: string;
  total: number;
  hits: SearchHit[];
}

export function groupHits(hits: SearchHit[], needle: string): TableHits[] {
  const groups = new Map<string, TableHits>();
  for (const h of rankHits(hits, needle)) {
    const group = groups.get(h.table) ?? { table: h.table, total: h.total, hits: [] };
    group.hits.push(h);
    groups.set(h.table, group);
  }
  return [...groups.values()];
}

export function useSearch(needle: string, per: number) {
  const text = needle.trim();
  return useQuery({
    queryKey: ["search", text, per],
    queryFn: () => api.search(text, per),
    enabled: enoughText(text),
    placeholderData: keepPreviousData,
  });
}
