import { Languages } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { m } from "@/paraglide/messages.js";
import { getLocale, type Locale, locales, setLocale } from "@/paraglide/runtime.js";

// each language is named in itself, so a reader can find their own
const NAMES: Record<Locale, string> = { en: "English", ja: "日本語" };

export function LanguageSelect() {
  const current = getLocale();
  return (
    <Select value={current} onValueChange={(v) => v !== current && setLocale(v as Locale)}>
      <SelectTrigger
        size="sm"
        aria-label={m.language_label()}
        className="h-6 gap-1 border-0 px-1.5 text-[11px] shadow-none max-md:size-10 max-md:justify-center max-md:p-0 max-md:[&>[data-slot=select-value]]:hidden max-md:[&>svg:last-child]:hidden"
      >
        <Languages className="size-3.5 max-md:size-4.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {locales.map((l) => (
          <SelectItem key={l} value={l} lang={l}>
            {NAMES[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
