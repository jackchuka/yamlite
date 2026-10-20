import "./lib/locale";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "./lib/providers";
import { getLocale } from "./paraglide/runtime.js";
import { createAppRouter } from "./router";

export function renderApp(el: HTMLElement, o: { app?: string } = {}): () => void {
  const router = createAppRouter(o.app);
  document.documentElement.lang = getLocale();
  const root = createRoot(el);
  root.render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  );
  return () => root.unmount();
}
