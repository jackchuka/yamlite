import { snippet } from "@/lib/search";

const MARK = "rounded-[3px] bg-tomato-soft text-inherit";

export function Snippet({ value, needle, around }: { value: string; needle: string; around?: number }) {
  const s = snippet(value, needle, around);
  return (
    <span>
      {s.before}
      {s.match && <mark className={MARK}>{s.match}</mark>}
      {s.after}
    </span>
  );
}

// a short text shown whole, with the needle marked where it occurs
export function Highlight({ text, needle }: { text: string; needle: string }) {
  return <Snippet value={text} needle={needle} around={Number.POSITIVE_INFINITY} />;
}
