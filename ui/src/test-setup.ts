import "./lib/locale";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { installMatchMedia, setMobile } from "./test/media";

installMatchMedia();
afterEach(() => {
  cleanup();
  setMobile(false);
  globalThis.localStorage?.removeItem("yamlite-locale");
});
