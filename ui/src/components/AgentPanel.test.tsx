import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AgentPanel } from "./AgentPanel";

const start = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn(async () => {}));
const pending = vi.hoisted(() => ({ list: [] as import("@/lib/agent").Proposal[] }));
vi.mock("@/lib/agent", async (orig) => {
  const real = await orig<typeof import("@/lib/agent")>();
  return {
    ...real,
    useAgents: () => [{ id: "claude", name: "Claude Code", login: "claude" }],
    usePendingProposals: () => pending.list,
    chat: Object.assign(Object.create(real.chat), { id: null, start, send, open, stop: vi.fn(), reset }),
  };
});
afterEach(cleanup);

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
  const box = screen.getByRole("textbox", { name: "AI への依頼" });
  fireEvent.change(box, { target: { value: "にほんご" } });
  fireEvent.keyDown(box, { key: "Enter", isComposing: true });
  fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
  fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
  expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(send).toHaveBeenCalledWith("にほんご"));
  expect(start).toHaveBeenCalledWith("claude");
});

test("a login failure tells the user what to run", async () => {
  const { ApiError } = await import("@/lib/api");
  start.mockRejectedValue(new ApiError(502, "auth", { code: "login" }));
  renderPanel();
  const box = screen.getByRole("textbox", { name: "AI への依頼" });
  fireEvent.change(box, { target: { value: "hi" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "送信" })));
  expect(await screen.findByText(/ターミナルで/)).toBeTruthy();
  expect(screen.getByText("claude")).toBeTruthy();
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

test("tool lines are labelled for both Claude and Codex names, and denied ones say so", async () => {
  renderPanel();
  await setChat({
    items: [
      { kind: "tool", id: "1", title: "mcp.yamlite.query", status: "completed" },
      { kind: "tool", id: "2", title: "mcp__yamlite__schema", status: "completed" },
      { kind: "tool", id: "3", title: "Bash", status: "denied" },
    ],
  });
  expect(screen.getByText("検索")).toBeTruthy();
  expect(screen.getByText("テーブル構成を確認")).toBeTruthy();
  expect(screen.getByText(/許可されていない操作を止めました（Bash）/)).toBeTruthy();
});

test("a spawn failure shows the reason", async () => {
  const { ApiError } = await import("@/lib/api");
  start.mockRejectedValue(new ApiError(502, "no such file", { code: "spawn" }));
  renderPanel();
  fireEvent.change(screen.getByRole("textbox", { name: "AI への依頼" }), { target: { value: "hi" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "送信" })));
  expect(await screen.findByText(/起動できませんでした: no such file/)).toBeTruthy();
});

test("a busy chat shows stop instead of send", async () => {
  renderPanel();
  await setChat({ busy: true });
  expect(screen.queryByRole("button", { name: "送信" })).toBeNull();
  expect(screen.getByRole("button", { name: /停止/ })).toBeTruthy();
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
    const earlier = screen.getByRole("region", { name: "未適用の提案" });
    expect(earlier.textContent).toContain("前の会話の提案");
    expect(earlier.textContent).not.toContain("今の提案");
    expect(screen.getAllByRole("region", { name: "提案: 今の提案" })).toHaveLength(1);
  } finally {
    pending.list = [];
  }
});

test("no earlier section when every pending proposal is in the chat", async () => {
  renderPanel();
  expect(screen.queryByRole("region", { name: "未適用の提案" })).toBeNull();
});

test("a status row shows while the agent is working and is gone otherwise", async () => {
  renderPanel();
  expect(screen.getByRole("status").textContent).toBe("");
  await setChat({ busy: true, items: [{ kind: "user", text: "hi" }] });
  const status = screen.getByRole("status");
  expect(status.textContent).toContain("考えています");
  expect(status.getAttribute("aria-live")).toBe("polite");
  await setChat({ busy: false, items: [{ kind: "user", text: "hi" }] });
  expect(screen.getByRole("status").textContent).toBe("");
});

test("the status row names the tool that is running", async () => {
  renderPanel();
  await setChat({
    busy: true,
    items: [{ kind: "tool", id: "1", title: "mcp__yamlite__query", status: "in_progress" }],
  });
  expect(screen.getByRole("status").textContent).toContain("検索 を実行中");
});

test("log children never shrink, so a proposal card cannot collapse in a long chat", () => {
  const { container } = renderPanel();
  expect(container.querySelector(".overflow-auto")?.className).toContain("[&>*]:shrink-0");
});

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

test("the 会話 menu lists conversations and opens the chosen one", async () => {
  const { agentApi } = await import("@/lib/agent");
  vi.spyOn(agentApi, "conversations").mockResolvedValue({
    conversations: [
      { id: "c2", agent: "claude", title: "今週のタスク", updatedAt: ago(1), status: "active" },
      { id: "c1", agent: "claude", title: "牛乳を完了に", updatedAt: ago(30), status: "dormant" },
      { id: "c0", agent: "claude", title: "古い会話", updatedAt: ago(60), status: "failed" },
    ],
  });
  renderPanel();
  fireEvent.keyDown(screen.getByRole("button", { name: "会話" }), { key: "Enter" });
  const item = await screen.findByRole("menuitem", { name: /牛乳を完了に/ });
  expect(item.textContent).toContain("休止中");
  expect(screen.getByRole("menuitem", { name: /古い会話/ }).textContent).toContain("再開できません");
  expect(screen.getByRole("menuitem", { name: /今週のタスク/ }).textContent).not.toMatch(/休止中|再開できません/);
  fireEvent.click(item);
  expect(open).toHaveBeenCalledWith("c1", "claude");
});

test("新しい会話 starts a fresh chat without ending the old one", async () => {
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "新しい会話" }));
  expect(reset).toHaveBeenCalled();
});

test("a failed conversation keeps its history and disables the input with a note", async () => {
  renderPanel();
  await setChat({ failed: true, items: [{ kind: "user", text: "前の依頼" }] });
  expect(screen.getByText("前の依頼")).toBeTruthy();
  expect(screen.getByText("この会話は再開できませんでした。新しい会話で続けてください。")).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "AI への依頼" }) as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "送信" }) as HTMLButtonElement).disabled).toBe(true);
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
    '<aside aria-label="record"></aside>',
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

test("Escape with the 会話 menu open closes only the menu", async () => {
  const { agentApi, agentPanel } = await import("@/lib/agent");
  vi.spyOn(agentApi, "conversations").mockResolvedValue({ conversations: [] });
  const close = vi.spyOn(agentPanel, "close");
  renderPanel();
  fireEvent.keyDown(screen.getByRole("button", { name: "会話" }), { key: "Enter" });
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
  const box = screen.getByRole("textbox", { name: "AI への依頼" });
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
