import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";

// one model answer: text, tool calls, or an error the provider call throws
export type Reply =
  | {
      say?: string;
      tools?: { name: string; args?: Record<string, unknown> }[];
      sources?: { url: string; title?: string }[];
    }
  | Error;

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

export function scripted(replies: Reply[]): MockLanguageModelV4 {
  let n = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const r = replies[n++] ?? { say: "" };
      if (r instanceof Error) throw r;
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      (r.sources ?? []).forEach((s, i) => parts.push({ type: "source", sourceType: "url", id: `src_${n}_${i}`, ...s }));
      if (r.say)
        parts.push(
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: r.say },
          { type: "text-end", id: "t" },
        );
      (r.tools ?? []).forEach((t, i) =>
        parts.push({
          type: "tool-call",
          toolCallId: `call_${n}_${i}`,
          toolName: t.name,
          input: JSON.stringify(t.args ?? {}),
        }),
      );
      parts.push({
        type: "finish",
        usage,
        finishReason: { unified: r.tools?.length ? "tool-calls" : "stop", raw: undefined },
      });
      return { stream: convertArrayToReadableStream(parts) as never };
    },
  });
}

export function hanging(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          c.enqueue({ type: "text-start", id: "t" });
          c.enqueue({ type: "text-delta", id: "t", delta: "…" });
          abortSignal?.addEventListener("abort", () => c.error(abortSignal.reason));
        },
      }) as never,
    }),
  });
}

export const promptText = (model: MockLanguageModelV4, call: number): string =>
  JSON.stringify(model.doStreamCalls[call]?.prompt ?? null);
