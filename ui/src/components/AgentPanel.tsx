import { ChevronDown, History, Square, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  agentPanel,
  type ChatItem,
  type ConversationSummary,
  chat,
  useAgents,
  useChat,
  useConversations,
  usePendingProposals,
} from "@/lib/agent";
import { ApiError } from "@/lib/api";
import { useDrawerWidth } from "@/lib/drawerWidth";
import { useIsMobile } from "@/lib/useIsMobile";
import { cn } from "@/lib/utils";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { ProposalCard } from "./ProposalCard";

const markdownStyle =
  "max-w-none min-w-0 [overflow-wrap:anywhere] [&_a]:underline [&_code]:font-mono [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:overflow-auto [&_table]:text-[14px] [&_ul]:list-disc [&_ul]:pl-5";
const TOOL_NAME = /^(?:mcp__yamlite__|mcp\.yamlite\.)(\w+)$/;
const TOOL_LABEL: Record<string, string> = {
  schema: "テーブル構成を確認",
  query: "検索",
  get_records: "レコードを読み込み",
  propose_changes: "変更を提案",
  propose_sql: "変更を提案",
  propose_table: "テーブルを提案",
  check: "ルールを確認",
};

const toolLabel = (title: string) => {
  const tool = TOOL_NAME.exec(title)?.[1];
  return tool ? (TOOL_LABEL[tool] ?? tool) : title;
};

function WorkingStatus({ busy, last }: { busy: boolean; last: ChatItem | undefined }) {
  const running = last?.kind === "tool" && last.status === "in_progress" ? toolLabel(last.title) : null;
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 text-[14px] text-muted-foreground">
      {busy && (
        <>
          <span aria-hidden className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </span>
          {running ? `${running} を実行中…` : "考えています…"}
        </>
      )}
    </p>
  );
}

function ToolLine({ item }: { item: Extract<ChatItem, { kind: "tool" }> }) {
  const label = item.status === "denied" ? `許可されていない操作を止めました（${item.title}）` : toolLabel(item.title);
  const sql = (item.input as { sql?: string } | undefined)?.sql;
  return (
    <details
      className={cn(
        "min-w-0 rounded-md border bg-panel px-2.5 py-1.5 text-[14px] text-muted-foreground",
        item.status === "denied" && "border-err text-err",
      )}
    >
      <summary className="cursor-pointer">
        {label}
        {item.status === "in_progress" && " …"}
      </summary>
      {item.input !== undefined && (
        <pre className="mt-1.5 font-mono text-[14px] whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
          {sql ?? JSON.stringify(item.input, null, 2)}
        </pre>
      )}
    </details>
  );
}

const newConversation = () => chat.reset().catch(() => {});

const hhmm = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" });
const dayHhmm = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const when = (iso: string) => {
  const d = new Date(iso);
  return (d.toDateString() === new Date().toDateString() ? hhmm : dayHhmm).format(d);
};
const STATUS_LABEL: Record<ConversationSummary["status"], string | null> = {
  active: null,
  dormant: "休止中",
  failed: "再開できません",
};

function ConversationMenu({ current, onPick }: { current: string | null; onPick: (c: ConversationSummary) => void }) {
  const [open, setOpen] = useState(false);
  const { conversations, loading } = useConversations(open);
  const agents = useAgents();
  const agentName = (id: string) => (agents.length > 1 ? agents.find((a) => a.id === id)?.name : undefined);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="text-[14px]">
          <History className="size-4" />
          会話
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        {conversations.length === 0 ? (
          <DropdownMenuItem disabled className="text-[14px]">
            {loading ? "読み込み中…" : "まだ会話はありません"}
          </DropdownMenuItem>
        ) : (
          conversations.map((c) => {
            const status = STATUS_LABEL[c.status];
            const name = agentName(c.agent);
            return (
              <DropdownMenuItem
                key={c.id}
                aria-current={c.id === current ? "true" : undefined}
                className="flex cursor-pointer flex-col items-stretch gap-0.5 py-2 aria-[current]:bg-panel-2"
                onSelect={() => onPick(c)}
              >
                <span className="truncate text-[15px]">{c.title || "（メッセージなし）"}</span>
                <span className="flex gap-2 text-[14px] text-muted-foreground">
                  <span>{when(c.updatedAt)}</span>
                  {name && <span>{name}</span>}
                  {status && <span className={cn(c.status === "failed" && "text-err")}>{status}</span>}
                </span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function startErrorText(e: unknown, agent: { name: string; login: string }): { text: string; command?: string } {
  if (e instanceof ApiError && e.body.code === "login")
    return {
      text: `${agent.name} にログインが必要です。ターミナルで次を実行してから、もう一度送信してください。`,
      command: agent.login,
    };
  if (e instanceof ApiError && e.body.code === "spawn")
    return { text: `${agent.name} を起動できませんでした: ${e.message}` };
  return { text: e instanceof Error ? e.message : String(e) };
}

export function AgentPanel() {
  const agents = useAgents();
  const state = useChat();
  const mobile = useIsMobile();
  const [width, setWidth] = useDrawerWidth("yamlite-agent-width", 420);
  const [agentId, setAgentId] = useState(chat.agentId ?? agents[0]?.id ?? "");
  const [text, setText] = useState("");
  const [startError, setStartError] = useState<{ text: string; command?: string } | null>(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const agent = agents.find((a) => a.id === agentId) ?? agents[0];
  const pending = usePendingProposals();
  const inChat = new Set(state.items.flatMap((i) => (i.kind === "proposal" ? [i.proposal.id] : [])));
  const earlier = pending.filter((p) => !inChat.has(p.id));

  useEffect(() => {
    // menus, dialogs and the record drawer take Escape first; Radix layers mark it handled and may already be gone
    const layer =
      '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], aside[aria-label="record"]';
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (document.querySelector(layer)) return;
      // other text fields use Escape themselves, and a draft is not thrown away
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && target !== input.current && target.closest("input, textarea, select, [contenteditable]")) return;
      if (input.current?.value.trim()) return;
      agentPanel.close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    log.current?.scrollTo?.({ top: log.current.scrollHeight });
  }, [state.items, state.busy]);

  if (!agent) return null;

  const submit = async () => {
    const message = text.trim();
    if (message === "" || state.busy || state.failed || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setStartError(null);
    try {
      if (!chat.id || state.closed) {
        await chat.reset();
        await chat.start(agent.id);
      }
      await chat.send(message);
      setText("");
    } catch (e) {
      setStartError(startErrorText(e, agent));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter confirms an IME conversion first; only a plain Enter afterwards sends
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    void submit();
  };

  return (
    <aside
      aria-label="AI に依頼"
      className={cn(
        "relative flex min-h-0 flex-col border-l bg-background",
        mobile && "fixed inset-0 z-40 h-dvh border-l-0",
      )}
      style={mobile ? undefined : { width }}
    >
      {!mobile && <PanelResizeHandle width={width} label="Resize AI panel" onResize={setWidth} />}
      <header className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-1">
          {agents.length > 1 ? (
            <label className="relative flex items-center">
              <span className="sr-only">エージェント</span>
              <select
                className="appearance-none rounded-md border bg-panel py-1.5 pr-8 pl-2.5 text-[15px]"
                value={agent.id}
                onChange={(e) => {
                  setAgentId(e.target.value);
                  setStartError(null);
                  void newConversation();
                }}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 size-4" />
            </label>
          ) : (
            <span className="truncate text-[15px] font-semibold">{agent.name}</span>
          )}
          <ConversationMenu
            current={chat.id}
            onPick={(c) => {
              setStartError(null);
              if (agents.some((a) => a.id === c.agent)) setAgentId(c.agent);
              chat.open(c.id, c.agent);
            }}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="text-[14px]"
            onClick={() => {
              setStartError(null);
              void newConversation();
            }}
          >
            新しい会話
          </Button>
          <Button variant="ghost" size="icon" aria-label="閉じる" onClick={agentPanel.close}>
            <X className="size-5" />
          </Button>
        </div>
      </header>
      <div
        ref={log}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5 text-[15px] leading-relaxed [&>*]:shrink-0"
      >
        {earlier.length > 0 && (
          <section aria-label="未適用の提案" className="flex flex-col gap-3 border-b pb-3">
            <h2 className="text-[15px] font-semibold">未適用の提案</h2>
            <p className="text-[14px] text-muted-foreground">前の会話で作られ、まだ適用も破棄もしていない提案です。</p>
            {earlier.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </section>
        )}
        {state.items.length === 0 && (
          <p className="text-muted-foreground">
            データの検索や編集を頼めます。例:「来週締め切りのタスクを一覧して」「errand タグのタスクを全部完了にして」
          </p>
        )}
        {state.items.map((item, i) =>
          item.kind === "user" ? (
            <p
              key={i}
              className="max-w-[85%] self-end rounded-xl rounded-br-sm bg-panel-2 px-3 py-2 whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {item.text}
            </p>
          ) : item.kind === "agent" ? (
            <div key={i} className={markdownStyle}>
              <Markdown
                remarkPlugins={[remarkGfm]}
                disallowedElements={["img"]}
                unwrapDisallowed
                components={{ a: ({ node: _node, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener" /> }}
              >
                {item.text}
              </Markdown>
            </div>
          ) : item.kind === "tool" ? (
            <ToolLine key={item.id} item={item} />
          ) : item.kind === "proposal" ? (
            <ProposalCard key={item.proposal.id} proposal={item.proposal} />
          ) : (
            <p key={i} role="alert" className="rounded-md border border-err px-3 py-2 text-err">
              {item.message}
            </p>
          ),
        )}
        <WorkingStatus busy={state.busy} last={state.items.at(-1)} />
        {state.failed && (
          <p className="text-muted-foreground">この会話は再開できませんでした。新しい会話で続けてください。</p>
        )}
        {state.closed && (
          <p className="text-muted-foreground">会話が終了しました。次のメッセージは新しい会話で送られます。</p>
        )}
        {startError && (
          <div role="alert" className="rounded-md border border-err px-3 py-2 text-err">
            <p>{startError.text}</p>
            {startError.command && <code className="mt-1 block font-mono">{startError.command}</code>}
          </div>
        )}
      </div>
      <form
        className="border-t p-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={input}
          aria-label="AI への依頼"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={state.failed}
          placeholder="例: 来週締め切りのタスクを一覧して"
          className="w-full resize-none rounded-lg border bg-panel px-3 py-2.5 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[14px] text-muted-foreground">読み取りと提案のみ。適用するまで保存されません</span>
          {state.busy ? (
            <Button type="button" variant="outline" onClick={() => void chat.stop()}>
              <Square className="size-4" /> 停止
            </Button>
          ) : (
            <Button type="submit" disabled={sending || state.failed || text.trim() === ""}>
              送信
            </Button>
          )}
        </div>
      </form>
    </aside>
  );
}
