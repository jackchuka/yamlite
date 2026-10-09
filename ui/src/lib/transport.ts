export interface Transport {
  fetch: typeof fetch;
  eventSource(url: string): EventSource;
}

let current: Transport = {
  fetch: (...a) => globalThis.fetch(...a),
  eventSource: (url) => new EventSource(url),
};

export const transport = (): Transport => current;
export function setTransport(t: Transport): void {
  current = t;
}
