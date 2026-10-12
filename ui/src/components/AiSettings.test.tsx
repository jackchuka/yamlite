import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { type AiProvider, currentChoice, saveChoice } from "@/lib/ai";
import { AiSettings } from "./AiSettings";

const PROVIDERS: AiProvider[] = [
  { id: "anthropic", name: "Anthropic", models: ["claude-sonnet-5-5", "claude-haiku-5-5"], hasKey: false },
  { id: "openai", name: "OpenAI", models: ["gpt-5", "gpt-5-mini"], hasKey: true },
];
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const keys = () => JSON.parse(localStorage.getItem("yamlite-ai") ?? "{}").keys;

function renderSettings() {
  const onSave = vi.fn((c, remember) => saveChoice(c, remember));
  render(<AiSettings providers={PROVIDERS} initial={currentChoice(PROVIDERS)} onSave={onSave} />);
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
