type Handler = () => void;

let mobile = false;
const handlers = new Set<Handler>();

export function setMobile(next: boolean): void {
  mobile = next;
  for (const h of handlers) h();
}

export function installMatchMedia(): void {
  // some suites run in node, without a window
  if (typeof window === "undefined") return;
  window.matchMedia = ((media: string) => ({
    media,
    get matches() {
      return media === "(width < 48rem)" ? mobile : false;
    },
    onchange: null,
    addEventListener: (_type: string, h: Handler) => handlers.add(h),
    removeEventListener: (_type: string, h: Handler) => handlers.delete(h),
    addListener: (h: Handler) => handlers.add(h),
    removeListener: (h: Handler) => handlers.delete(h),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
