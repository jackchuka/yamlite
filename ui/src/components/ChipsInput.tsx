import { X } from "lucide-react";
import { useState } from "react";
import { chip } from "@/components/ui/field";
import { m } from "@/paraglide/messages.js";

export function ChipsInput({
  label,
  value,
  onChange,
  placeholder = m.form_add_placeholder(),
  removeLabel = (item) => m.form_remove({ item }),
  accept = () => true,
  unique = false,
  invalid = false,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  removeLabel?: (chip: string) => string;
  // a text it rejects stays in the input
  accept?: (text: string) => boolean;
  unique?: boolean;
  // drawn with a warning border
  invalid?: boolean;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (t === "") return setText("");
    if (!accept(t)) return;
    if (!(unique && value.includes(t))) onChange([...value, t]);
    setText("");
  };
  return (
    <div
      className={`flex min-h-9 flex-wrap items-center gap-1 rounded-md border ${invalid ? "border-warn" : ""} bg-background px-1.5 py-1 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50`}
    >
      {value.map((c, i) => (
        <span key={`${i}-${c}`} className={chip}>
          {c}
          <button
            type="button"
            aria-label={removeLabel(c)}
            className="ml-1 opacity-60 hover:opacity-100 max-md:grid max-md:size-7 max-md:place-items-center"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        className="min-w-32 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !e.repeat && text === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={add}
      />
      {text.trim() !== "" && (
        <button
          type="button"
          aria-label={m.form_add_to({ field: label })}
          className="rounded-md px-2 text-[13px] text-muted-foreground md:hidden"
          // keeps focus in the input, so its blur does not add the chip first
          onMouseDown={(e) => e.preventDefault()}
          onClick={add}
        >
          {m.form_add()}
        </button>
      )}
    </div>
  );
}
