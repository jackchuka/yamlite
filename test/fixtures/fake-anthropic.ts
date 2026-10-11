import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeReply = { say?: string; tools?: { name: string; args?: Record<string, unknown> }[] };

const ev = (type: string, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

// the Messages API, streamed: the n-th request gets the n-th reply; requests without the browser-access header fail
export async function fakeAnthropic(replies: FakeReply[]): Promise<{ url: string; requests: unknown[] }> {
  const requests: unknown[] = [];
  let n = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.headers["anthropic-dangerous-direct-browser-access"] !== "true") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "browser access header missing" },
          }),
        );
        return;
      }
      requests.push(JSON.parse(body));
      const r = replies[n++] ?? { say: "" };
      const out = [
        ev("message_start", {
          message: {
            id: `msg_${n}`,
            type: "message",
            role: "assistant",
            model: "fake",
            content: [],
            stop_reason: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        }),
      ];
      let i = 0;
      if (r.say) {
        out.push(
          ev("content_block_start", { index: i, content_block: { type: "text", text: "" } }),
          ev("content_block_delta", { index: i, delta: { type: "text_delta", text: r.say } }),
          ev("content_block_stop", { index: i }),
        );
        i++;
      }
      for (const t of r.tools ?? []) {
        out.push(
          ev("content_block_start", {
            index: i,
            content_block: { type: "tool_use", id: `toolu_${n}_${i}`, name: t.name, input: {} },
          }),
          ev("content_block_delta", {
            index: i,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(t.args ?? {}) },
          }),
          ev("content_block_stop", { index: i }),
        );
        i++;
      }
      out.push(
        ev("message_delta", {
          delta: { stop_reason: r.tools?.length ? "tool_use" : "end_turn" },
          usage: { output_tokens: 1 },
        }),
        ev("message_stop", {}),
      );
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(out.join(""));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  server.unref();
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests };
}
