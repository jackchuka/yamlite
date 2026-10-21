import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { type AiProvider, currentChoice, saveChoice } from "@/lib/ai";
import { AiSettings } from "./AiSettings";

const PROVIDERS: AiProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-5-5", "claude-haiku-5-5"],
    fixedModels: false,
    hasKey: false,
  },
  { id: "openai", name: "OpenAI", models: ["gpt-5", "gpt-5-mini"], fixedModels: false, hasKey: true },
];
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const keys = () => JSON.parse(localStorage.getItem("yamlite-ai") ?? "{}").keys;

function renderSettings() {
  const onSave = vi.fn((c, remember) => saveChoice(c, remember));
  render(<AiSettings viewerKeys providers={PROVIDERS} initial={currentChoice(PROVIDERS)} onSave={onSave} />);
  return onSave;
}

test("saving only a new model keeps a remembered key", () => {
  saveChoice({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-a" }, true);
  renderSettings();
  expect((screen.getByLabelText("Remember the key on this device") as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "claude-haiku-5-5" } });
  fireEvent.submit(screen.getByRole("form", { name: "AI settings" }));
  expect(keys()).toEqual({ anthropic: "sk-a" });
});

test("switching provider shows that provider's saved key and saving keeps both", () => {
  saveChoice({ provider: "openai", model: "gpt-5", apiKey: "sk-o" }, true);
  saveChoice({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-a" }, true);
  renderSettings();
  const key = screen.getByLabelText("API key") as HTMLInputElement;
  expect(key.value).toBe("sk-a");
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
  expect(key.value).toBe("sk-o");
  expect((screen.getByLabelText("Remember the key on this device") as HTMLInputElement).checked).toBe(true);
  fireEvent.submit(screen.getByRole("form", { name: "AI settings" }));
  expect(keys()).toEqual({ anthropic: "sk-a", openai: "sk-o" });
});

test("switching to a provider with no saved key leaves the field empty and unticked", () => {
  saveChoice({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-a" }, true);
  renderSettings();
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
  expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Remember the key on this device") as HTMLInputElement).checked).toBe(false);
});

test("a model outside the suggestions can be typed and is marked unverified", () => {
  const onSave = renderSettings();
  const model = screen.getByLabelText("Model") as HTMLInputElement;
  expect(model.value).toBe("gpt-5");
  expect(screen.queryByText(/not been checked with YAMLite/)).toBeNull();
  fireEvent.change(model, { target: { value: "gpt-6" } });
  expect(screen.getByText(/not been checked with YAMLite/)).toBeTruthy();
  fireEvent.submit(screen.getByRole("form", { name: "AI settings" }));
  expect(onSave).toHaveBeenCalledWith({ provider: "openai", model: "gpt-6", apiKey: "" }, false);
});

test("an empty model cannot be saved", () => {
  renderSettings();
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "  " } });
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
});

test("without viewer keys there is no key field and a fixed list is picked from", () => {
  saveChoice({ provider: "openai", model: "gpt-5", apiKey: "sk-o" }, true);
  const opts = { viewerKeys: false };
  const fixed = PROVIDERS.map((p) => ({ ...p, fixedModels: true }));
  const onSave = vi.fn();
  render(<AiSettings viewerKeys={false} providers={fixed} initial={currentChoice(fixed, opts)} onSave={onSave} />);
  expect(screen.queryByLabelText("API key")).toBeNull();
  expect(screen.queryByLabelText("Remember the key on this device")).toBeNull();
  const model = screen.getByLabelText("Model") as HTMLSelectElement;
  expect(model.tagName).toBe("SELECT");
  expect([...model.options].map((o) => o.value)).toEqual(["gpt-5", "gpt-5-mini"]);
  fireEvent.change(model, { target: { value: "gpt-5-mini" } });
  fireEvent.submit(screen.getByRole("form", { name: "AI settings" }));
  expect(onSave).toHaveBeenCalledWith({ provider: "openai", model: "gpt-5-mini", apiKey: "" }, false);
});

test("without viewer keys a list that is not fixed still takes any model", () => {
  const onSave = vi.fn();
  render(<AiSettings viewerKeys={false} providers={PROVIDERS} initial={null} onSave={onSave} />);
  const model = screen.getByLabelText("Model") as HTMLInputElement;
  expect(model.tagName).toBe("INPUT");
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
  fireEvent.change(model, { target: { value: "gpt-next" } });
  fireEvent.submit(screen.getByRole("form", { name: "AI settings" }));
  expect(onSave).toHaveBeenCalledWith({ provider: "openai", model: "gpt-next", apiKey: "" }, false);
});

test("without viewer keys the browser's stored keys are not read", () => {
  const getItem = vi.spyOn(Storage.prototype, "getItem");
  try {
    render(<AiSettings viewerKeys={false} providers={PROVIDERS} initial={null} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
    expect(getItem).not.toHaveBeenCalledWith("yamlite-ai");
  } finally {
    getItem.mockRestore();
  }
});

test("currentChoice ignores a stored viewer key when viewer keys are off", () => {
  saveChoice({ provider: "openai", model: "gpt-5", apiKey: "sk-o" }, true);
  expect(currentChoice(PROVIDERS, { viewerKeys: false })).toEqual({ provider: "openai", model: "gpt-5", apiKey: "" });
  expect(currentChoice([PROVIDERS[0] as AiProvider], { viewerKeys: false })).toBeNull();
});
