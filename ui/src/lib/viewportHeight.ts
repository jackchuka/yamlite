import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", onChange);
  vv?.addEventListener("scroll", onChange);
  return () => {
    vv?.removeEventListener("resize", onChange);
    vv?.removeEventListener("scroll", onChange);
  };
};

// the height left above an on-screen keyboard; dvh does not shrink for it on iOS
export function useViewportHeight(enabled: boolean): number | undefined {
  const height = useSyncExternalStore(subscribe, () => window.visualViewport?.height);
  return enabled ? height : undefined;
}
