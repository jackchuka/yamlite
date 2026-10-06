import { m } from "@/paraglide/messages.js";

export function Placeholder({ title }: { title: string }) {
  return <div className="p-6 text-muted-foreground">{m.shell_placeholder({ title })}</div>;
}
