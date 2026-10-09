import "./styles.css";
import { renderApp } from "./app";
import { setTransport, type Transport } from "./lib/transport";
import { applyMountOptions, type MountOptions } from "./lib/mount";

export type { Transport };
export { createWorkerTransport } from "./lib/workerTransport";

// routes live in the url hash, so the host page keeps its own path
export function mount(el: HTMLElement, o: MountOptions & { transport: Transport }): () => void {
  setTransport(o.transport);
  applyMountOptions(el, o);
  return renderApp(el);
}
