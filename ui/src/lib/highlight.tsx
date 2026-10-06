import { createContext, useContext } from "react";

// the table's search text, so cells can mark what matched
export const SearchTerm = createContext("");

export function splitMatches(text: string, term: string): Array<{ text: string; match: boolean }> {
  if (term === "") return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const out: Array<{ text: string; match: boolean }> = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, at)) {
    if (i > at) out.push({ text: text.slice(at, i), match: false });
    out.push({ text: text.slice(i, i + needle.length), match: true });
    at = i + needle.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out;
}

export function Highlight({ text }: { text: string }) {
  const term = useContext(SearchTerm);
  const parts = splitMatches(text, term);
  if (parts.length === 1 && !parts[0]?.match) return text;
  return parts.map((p, i) =>
    p.match ? (
      <mark key={i} className="rounded-[2px] bg-warn-soft text-foreground">
        {p.text}
      </mark>
    ) : (
      p.text
    ),
  );
}
