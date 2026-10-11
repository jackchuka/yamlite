import type { ReactNode } from "react";
import { sectionHeading } from "@/components/ui/field";
import { cn } from "@/lib/utils";

// a section of a dialog: a bordered card whose header band holds the heading and the section's actions
export function SectionCard({
  title,
  heading,
  actions,
  flush = false,
  children,
}: {
  title: string;
  // shown next to the title, e.g. a breadcrumb
  heading?: ReactNode;
  actions?: ReactNode;
  // the body lays out its own padding
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section data-slot="section-card" className="overflow-hidden rounded-lg border">
      <header className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted px-4 py-1.5">
        <h3 className={sectionHeading}>{title}</h3>
        {heading}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </header>
      <div className={cn(!flush && "flex flex-col gap-2 px-4 py-3")}>{children}</div>
    </section>
  );
}
