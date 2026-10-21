import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AgentPanel } from "./AgentPanel";

const start = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn(async () => {}));
const pending = vi.hoisted(() => ({ list: [] as import("@/lib/agent").Proposal[] }));
const providers = vi.hoisted(() => ({
  list: [
    { id: "anthropic", name: "Anthropic", models: ["claude-sonnet-5-5"], hasKey: true },
  ] as import("@/lib/ai").AiProvider[],
}));
const host = vi.hoisted(() => ({ value: { viewerKeys: true, settingsUrl: null as string | null } }));
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  useAiProviders: () => providers.list,
  useAiHost: () => host.value,
}));
vi.mock("@/lib/agent", async (orig) => {
  const real = await orig<typeof import("@/lib/agent")>();
  return {
    ...real,
    usePendingProposals: () => pending.list,
    chat: Object.assign(Object.create(real.chat), { id: null, start, send, open, stop: vi.fn(), reset }),
  };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  providers.list = [{ id: "anthropic", name: "Anthropic", models: ["claude-sonnet-5-5"], hasKey: true }];
  host.value = { viewerKeys: true, settingsUrl: null };
});

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentPanel />
    </QueryClientProvider>,
  );

test("Enter sends, Shift+Enter and IME composition do not", async () => {
  start.mockResolvedValue(undefined);
  send.mockResolvedValue(undefined);
  renderPanel();
  const box = screen.getByRole("textbox", { name: "Request to the AI" });
  fireEvent.change(box, { target: { value: "にほんご" } });
  fireEvent.keyDown(box, { key: "Enter", isComposing: true });
  fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
  fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
  expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(send).toHaveBeenCalledWith("にほんご"));
  expect(start).toHaveBeenCalledWith({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "" });
});

type AgentModule = typeof import("@/lib/agent");
const setChat = async (state: Partial<import("@/lib/agent").ChatState>) => {
  const { chat: real, EMPTY_CHAT } = await vi.importActual<AgentModule>("@/lib/agent");
  act(() => {
    (real as unknown as { set: (s: unknown) => void }).set({ ...EMPTY_CHAT, ...state });
  });
};
afterEach(() => setChat({}));

test("agent links open in a new tab and images are dropped", async () => {
  renderPanel();
  await setChat({
    items: [{ kind: "agent", text: "[docs](https://e/d) ![x](https://e/x.png)" }],
  });
  const link = screen.getByRole("link", { name: "docs" });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(document.querySelector("img")).toBeNull();
});

test("tool lines are labelled by tool name", async () => {
  renderPanel();
  await setChat({
    items: [
      { kind: "tool", id: "1", title: "query", status: "completed" },
      { kind: "tool", id: "2", title: "schema", status: "completed" },
    ],
  });
  expect(screen.getByText("Searching")).toBeTruthy();
  expect(screen.getByText("Checking the tables")).toBeTruthy();
});

test("without a key the settings form comes first, and saving starts with the chosen model", async () => {
  providers.list = [{ id: "openai", name: "OpenAI", models: ["gpt-5", "gpt-5-mini"], hasKey: false }];
  start.mockResolvedValue(undefined);
  send.mockResolvedValue(undefined);
  renderPanel();
  const form = screen.getByRole("form", { name: "AI settings" });
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5-mini" } });
  fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test" } });
  await act(async () => fireEvent.submit(form));
  expect(screen.queryByRole("form", { name: "AI settings" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Request to the AI" }), { target: { value: "hi" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(start).toHaveBeenCalledWith({ provider: "openai", model: "gpt-5-mini", apiKey: "sk-test" });
  expect(localStorage.getItem("yamlite-ai")).not.toContain("sk-test");
});

test("an auth error in the chat opens the settings", async () => {
  renderPanel();
  expect(screen.queryByRole("form", { name: "AI settings" })).toBeNull();
  await setChat({ items: [{ kind: "error", code: "auth", message: "rejected" }] });
  expect(screen.getByRole("form", { name: "AI settings" })).toBeTruthy();
});

test("a busy chat shows stop instead of send", async () => {
  renderPanel();
  await setChat({ busy: true });
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  expect(screen.getByRole("button", { name: /Stop/ })).toBeTruthy();
});

const proposal = (id: string, title: string, conversationId: string): import("@/lib/agent").Proposal => ({
  id,
  conversationId,
  title,
  status: "pending",
  createdAt: "",
  rows: [{ table: "tasks", key: "a", op: "update", before: { done: false }, after: { done: true }, changed: ["done"] }],
  warnings: [],
});

test("pending proposals from earlier conversations are listed above the chat", async () => {
  const current = proposal("p2", "今の提案", "c2");
  pending.list = [proposal("p1", "前の会話の提案", "c1"), current];
  try {
    renderPanel();
    await setChat({ items: [{ kind: "proposal", proposal: current }] });
    const earlier = screen.getByRole("region", { name: "Unapplied proposals" });
    expect(earlier.textContent).toContain("前の会話の提案");
    expect(earlier.textContent).not.toContain("今の提案");
    expect(screen.getAllByRole("region", { name: "Proposal: 今の提案" })).toHaveLength(1);
  } finally {
    pending.list = [];
  }
});

test("no earlier section when every pending proposal is in the chat", async () => {
  renderPanel();
  expect(screen.queryByRole("region", { name: "Unapplied proposals" })).toBeNull();
});

test("a status row shows while the agent is working and is gone otherwise", async () => {
  renderPanel();
  expect(screen.getByRole("status").textContent).toBe("");
  await setChat({ busy: true, items: [{ kind: "user", text: "hi" }] });
  const status = screen.getByRole("status");
  expect(status.textContent).toContain("Thinking");
  expect(status.getAttribute("aria-live")).toBe("polite");
  await setChat({ busy: false, items: [{ kind: "user", text: "hi" }] });
  expect(screen.getByRole("status").textContent).toBe("");
});

test("the status row names the tool that is running", async () => {
  renderPanel();
  await setChat({
    busy: true,
    items: [{ kind: "tool", id: "1", title: "query", status: "in_progress" }],
  });
  expect(screen.getByRole("status").textContent).toContain("Searching…");
});

test("log children never shrink, so a proposal card cannot collapse in a long chat", () => {
  const { container } = renderPanel();
  expect(container.querySelector(".overflow-auto")?.className).toContain("[&>*]:shrink-0");
});

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

test("the Conversations menu lists conversations and opens the chosen one", async () => {
  const { agentApi } = await import("@/lib/agent");
  vi.spyOn(agentApi, "conversations").mockResolvedValue({
    conversations: [
      { id: "c2", provider: "anthropic", model: "claude-sonnet-5-5", title: "今週のタスク", updatedAt: ago(1) },
      { id: "c1", provider: "openai", model: "gpt-5", title: "牛乳を完了に", updatedAt: ago(30) },
    ],
  });
  renderPanel();
  fireEvent.keyDown(screen.getByRole("button", { name: "Conversations" }), { key: "Enter" });
  const item = await screen.findByRole("menuitem", { name: /牛乳を完了に/ });
  expect(item.textContent).toContain("gpt-5");
  fireEvent.click(item);
  expect(open).toHaveBeenCalledWith("c1");
});

test("New conversation starts a fresh chat without ending the old one", async () => {
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
  expect(reset).toHaveBeenCalled();
});

test("Escape closes the panel", async () => {
  const { agentPanel } = await import("@/lib/agent");
  const close = vi.spyOn(agentPanel, "close");
  renderPanel();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  close.mockRestore();
});

test("Escape leaves the panel open while composing, or while a menu, dialog or record drawer is open", async () => {
  const { agentPanel } = await import("@/lib/agent");
  const close = vi.spyOn(agentPanel, "close");
  renderPanel();
  fireEvent.keyDown(document.body, { key: "Escape", isComposing: true });
  fireEvent.keyDown(document.body, { key: "Escape", keyCode: 229 });
  const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  handled.preventDefault();
  document.body.dispatchEvent(handled);
  for (const html of [
    '<div data-radix-popper-content-wrapper=""></div>',
    '<div role="dialog"></div>',
    '<div role="alertdialog"></div>',
    "<aside data-record-drawer></aside>",
  ]) {
    const layer = document.createElement("div");
    layer.innerHTML = html;
    document.body.append(layer);
    fireEvent.keyDown(document.body, { key: "Escape" });
    layer.remove();
  }
  expect(close).not.toHaveBeenCalled();
  close.mockRestore();
});

test("Escape with the Conversations menu open closes only the menu", async () => {
  const { agentApi, agentPanel } = await import("@/lib/agent");
  vi.spyOn(agentApi, "conversations").mockResolvedValue({ conversations: [] });
  const close = vi.spyOn(agentPanel, "close");
  renderPanel();
  fireEvent.keyDown(screen.getByRole("button", { name: "Conversations" }), { key: "Enter" });
  const menu = await screen.findByRole("menu");
  fireEvent.keyDown(menu, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  close.mockRestore();
});

test("Escape keeps the panel open with an unsent draft, and in another text field", async () => {
  const { agentPanel } = await import("@/lib/agent");
  const close = vi.spyOn(agentPanel, "close");
  renderPanel();
  const box = screen.getByRole("textbox", { name: "Request to the AI" });
  fireEvent.change(box, { target: { value: "書きかけ" } });
  fireEvent.keyDown(box, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: "" } });
  const search = document.createElement("input");
  document.body.append(search);
  fireEvent.keyDown(search, { key: "Escape" });
  search.remove();
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  close.mockRestore();
});

test("with no host key and no viewer keys it says so and links to the settings", () => {
  providers.list = [];
  host.value = { viewerKeys: false, settingsUrl: "https://example.com/settings/ai" };
  renderPanel();
  expect(screen.getByText(/No AI key is set up for this repository/)).toBeTruthy();
  const link = screen.getByRole("link", { name: "AI settings" });
  expect(link.getAttribute("href")).toBe("https://example.com/settings/ai");
  expect(link.getAttribute("target")).toBeNull();
  expect(screen.queryByRole("form", { name: "AI settings" })).toBeNull();
  expect((screen.getByRole("textbox", { name: "Request to the AI" }) as HTMLTextAreaElement).disabled).toBe(true);
});

test("with no host key and no settings URL there is no link", () => {
  providers.list = [];
  host.value = { viewerKeys: false, settingsUrl: null };
  renderPanel();
  expect(screen.getByText(/No AI key is set up for this repository/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "AI settings" })).toBeNull();
});

test("without viewer keys an auth error says so and links to the settings instead of opening the form", async () => {
  host.value = { viewerKeys: false, settingsUrl: "https://example.com/settings/ai" };
  renderPanel();
  await setChat({ items: [{ kind: "error", code: "auth", message: "rejected" }] });
  expect(screen.queryByRole("form", { name: "AI settings" })).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain(
    "The AI key for this repository was refused. Ask a repository admin to check it.",
  );
  const link = screen.getByRole("link", { name: "AI settings" });
  expect(link.getAttribute("href")).toBe("https://example.com/settings/ai");
  expect(link.getAttribute("target")).toBeNull();
});

test("without viewer keys or a settings URL an auth error has no link", async () => {
  host.value = { viewerKeys: false, settingsUrl: null };
  renderPanel();
  await setChat({ items: [{ kind: "error", code: "auth", message: "rejected" }] });
  expect(screen.queryByRole("form", { name: "AI settings" })).toBeNull();
  expect(screen.getByText(/The AI key for this repository was refused/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "AI settings" })).toBeNull();
});
