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
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { ProposalCard } from "./ProposalCard";
import { m } from "@/paraglide/messages.js";

const markdownStyle =
  "max-w-none min-w-0 [overflow-wrap:anywhere] [&_a]:underline [&_code]:font-mono [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:overflow-auto [&_table]:text-[14px] [&_ul]:list-disc [&_ul]:pl-5";
const TOOL_NAME = /^(?:mcp__yamlite__|mcp\.yamlite\.)(\w+)$/;
const TOOL_LABEL: Record<string, () => string> = {
  schema: m.agent_tool_schema,
  query: m.agent_tool_query,
  get_records: m.agent_tool_get_records,
  propose_changes: m.agent_tool_propose_changes,
  propose_sql: m.agent_tool_propose_changes,
  propose_table: m.agent_tool_propose_table,
  check: m.agent_tool_check,
};

const toolLabel = (title: string) => {
  const tool = TOOL_NAME.exec(title)?.[1];
  return tool ? (TOOL_LABEL[tool]?.() ?? tool) : title;
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
          {running ? m.agent_running({ tool: running }) : m.agent_thinking()}
        </>
      )}
    </p>
  );
}

function ToolLine({ item }: { item: Extract<ChatItem, { kind: "tool" }> }) {
  const label = item.status === "denied" ? m.agent_denied({ tool: item.title }) : toolLabel(item.title);
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

const STATUS_LABEL: Record<ConversationSummary["status"], (() => string) | null> = {
  active: null,
  dormant: m.agent_status_dormant,
  failed: m.agent_status_failed,
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
          {m.agent_conversations()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        {conversations.length === 0 ? (
          <DropdownMenuItem disabled className="text-[14px]">
            {loading ? m.common_loading() : m.agent_no_conversations()}
          </DropdownMenuItem>
        ) : (
          conversations.map((c) => {
            const status = STATUS_LABEL[c.status]?.();
            const name = agentName(c.agent);
            return (
              <DropdownMenuItem
                key={c.id}
                aria-current={c.id === current ? "true" : undefined}
                className="flex cursor-pointer flex-col items-stretch gap-0.5 py-2 aria-[current]:bg-panel-2"
                onSelect={() => onPick(c)}
              >
                <span className="truncate text-[15px]">{c.title || m.agent_untitled()}</span>
                <span className="flex gap-2 text-[14px] text-muted-foreground">
                  <span>{formatWhen(c.updatedAt)}</span>
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
      text: m.agent_login_required({ agent: agent.name }),
      command: agent.login,
    };
  if (e instanceof ApiError && e.body.code === "spawn")
    return { text: m.agent_spawn_failed({ agent: agent.name, error: e.message }) };
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
      '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], aside[data-record-drawer]';
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
      aria-label={m.nav_ask_ai()}
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
              <span className="sr-only">{m.agent_agent()}</span>
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
            {m.agent_new_conversation()}
          </Button>
          <Button variant="ghost" size="icon" aria-label={m.common_close()} onClick={agentPanel.close}>
            <X className="size-5" />
          </Button>
        </div>
      </header>
      <div
        ref={log}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5 text-[15px] leading-relaxed [&>*]:shrink-0"
      >
        {earlier.length > 0 && (
          <section aria-label={m.agent_pending_proposals()} className="flex flex-col gap-3 border-b pb-3">
            <h2 className="text-[15px] font-semibold">{m.agent_pending_proposals()}</h2>
            <p className="text-[14px] text-muted-foreground">{m.agent_pending_proposals_note()}</p>
            {earlier.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </section>
        )}
        {state.items.length === 0 && <p className="text-muted-foreground">{m.agent_intro()}</p>}
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
        {state.failed && <p className="text-muted-foreground">{m.agent_resume_failed()}</p>}
        {state.closed && <p className="text-muted-foreground">{m.agent_closed()}</p>}
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
          aria-label={m.agent_input()}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={state.failed}
          placeholder={m.agent_placeholder()}
          className="w-full resize-none rounded-lg border bg-panel px-3 py-2.5 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[14px] text-muted-foreground">{m.agent_read_only_note()}</span>
          {state.busy ? (
            <Button type="button" variant="outline" onClick={() => void chat.stop()}>
              <Square className="size-4" /> {m.agent_stop()}
            </Button>
          ) : (
            <Button type="submit" disabled={sending || state.failed || text.trim() === ""}>
              {m.agent_send()}
            </Button>
          )}
        </div>
      </form>
    </aside>
  );
}
