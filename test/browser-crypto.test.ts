import { expect, test } from "vitest";
import { randomBytes } from "../src/browser/crypto.ts";

test("randomBytes returns a Buffer that hex-encodes", () => {
  expect(randomBytes(6).toString("hex")).toMatch(/^[0-9a-f]{12}$/);
});
