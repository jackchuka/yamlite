import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LoadFailure } from "./components/LoadFailure";
import { setBackend } from "./lib/api";
import { enterStatic, isStaticPage } from "./lib/mode";
import { Providers } from "./lib/providers";
import { router } from "./router";
import "./styles.css";

async function boot() {
  const root = createRoot(document.getElementById("root") as HTMLElement);
  if (isStaticPage()) {
    try {
      const { loadStatic } = await import("./lib/static/load");
      const { api, snapshot } = await loadStatic();
      setBackend(api);
      enterStatic(snapshot);
    } catch (e) {
      root.render(<LoadFailure error={e} />);
      return;
    }
  }
  root.render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  );
}

void boot();
