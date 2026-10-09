import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export function createHash(alg: string) {
  if (alg !== "sha256") throw new Error(`createHash(${alg}) is not available in the browser build`);
  const parts: Uint8Array[] = [];
  return {
    update(data: string | Uint8Array) {
      parts.push(typeof data === "string" ? utf8ToBytes(data) : data);
      return this;
    },
    digest(enc: "hex") {
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        all.set(p, at);
        at += p.length;
      }
      if (enc !== "hex") throw new Error("only hex digests");
      return bytesToHex(sha256(all));
    },
  };
}
export const randomBytes = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
export const timingSafeEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
