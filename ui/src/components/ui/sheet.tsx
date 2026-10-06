import type * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Sheet = DialogPrimitive.Root;

const SIDES = {
  left: "inset-y-0 left-0 h-dvh w-[82%] max-w-[320px] border-r animate-[y-slide-right_160ms_ease-out]",
  bottom: "inset-x-0 bottom-0 max-h-dvh border-t animate-[y-slide-up_160ms_ease-out]",
} as const;

function SheetContent({
  side,
  title,
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side: keyof typeof SIDES; title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn("fixed z-50 flex flex-col bg-panel shadow-xl outline-none", SIDES[side], className)}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetContent };
