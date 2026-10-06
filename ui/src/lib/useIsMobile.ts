import { useSyncExternalStore } from "react";

// the same edge as Tailwind's md, so markup chosen in JS agrees with the max-md: classes
export const MOBILE_QUERY = "(width < 48rem)";

const subscribe = (onChange: () => void) => {
  const list = matchMedia(MOBILE_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
};

export const useIsMobile = (): boolean => useSyncExternalStore(subscribe, () => matchMedia(MOBILE_QUERY).matches);
