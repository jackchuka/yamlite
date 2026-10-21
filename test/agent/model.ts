import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";

// one model answer: text, tool calls, or an error the provider call throws;
// deltas stream the text in pieces, and fail ends the stream with an error after them
export type Reply =
  | {
      say?: string;
      deltas?: string[];
      fail?: Error;
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
    doGenerate: async () => {
      const r = replies[n++] ?? { say: "" };
      if (r instanceof Error) throw r;
      return {
        content: [{ type: "text", text: r.say ?? r.deltas?.join("") ?? "" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
    doStream: async () => {
      const r = replies[n++] ?? { say: "" };
      if (r instanceof Error) throw r;
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      (r.sources ?? []).forEach((s, i) => parts.push({ type: "source", sourceType: "url", id: `src_${n}_${i}`, ...s }));
      const deltas = r.deltas ?? (r.say ? [r.say] : []);
      if (deltas.length)
        parts.push(
          { type: "text-start", id: "t" },
          ...deltas.map((delta) => ({ type: "text-delta", id: "t", delta })),
          { type: "text-end", id: "t" },
        );
      if (r.fail) {
        parts.push({ type: "error", error: r.fail });
        return { stream: convertArrayToReadableStream(parts) as never };
      }
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
