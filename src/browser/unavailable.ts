// modules a browser build never runs (git, agents, the HTTP server, file watching); importing them must still link
const no = (what: string) => () => {
  throw new Error(`${what} is not available in the browser build`);
};
export const spawn = no("child_process.spawn");
export const pipeline = no("stream.pipeline");
export class Readable {}
export class Writable {}
export const fileURLToPath = (u: string | URL) => new URL(u).pathname;
export class ClientSideConnection {}
export const ndJsonStream = no("ndJsonStream");
export const PROTOCOL_VERSION = 0;
export const watch = () => {
  const w = { on: () => w, close: async () => {}, add: () => w, unwatch: () => w };
  return w;
};
export default {};
