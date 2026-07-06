import { NextRequest } from "next/server";

// Fan-out endpoint: the browser limits concurrent HTTP/1.1 connections per
// origin (~6 in Chrome), so opening one streaming request per model makes
// large multi-model runs complete in slow "waves". This route takes ALL target
// models in a single request, calls the existing per-model /api/chat handler in
// parallel on the server (Node/undici has no 6-connection cap), and multiplexes
// every model's NDJSON events back over one response stream, tagged with the
// client-side model id.

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; [key: string]: unknown }>;
};

type MultiItem = {
  id: string; // client-side model id (store/thread key)
  model: string; // resolved model id sent to /api/chat
  messages: ChatMessage[];
};

type MultiRequestBody = {
  items: MultiItem[];
  apiKey?: string;
  geminiApiKey?: string;
  opencodeApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaApiKey?: string;
  ollamaCloudBaseUrl?: string;
  customProviders?: Array<{ id: string; name: string; baseUrl: string; apiKey: string; models: string[] }>;
};

export async function POST(req: NextRequest) {
  let body: MultiRequestBody;
  try {
    body = (await req.json()) as MultiRequestBody;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return new Response("Missing items", { status: 400 });
  }

  const origin = req.nextUrl.origin;
  const shared = {
    apiKey: body.apiKey,
    geminiApiKey: body.geminiApiKey,
    opencodeApiKey: body.opencodeApiKey,
    ollamaBaseUrl: body.ollamaBaseUrl,
    ollamaApiKey: body.ollamaApiKey,
    ollamaCloudBaseUrl: body.ollamaCloudBaseUrl,
    customProviders: body.customProviders,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      await Promise.all(
        body.items.map(async (item) => {
          try {
            const upstream = await fetch(`${origin}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: item.model, messages: item.messages, ...shared }),
              signal: req.signal,
            });

            if (!upstream.ok || !upstream.body) {
              const errBody = await upstream.text().catch(() => upstream.statusText);
              send({
                id: item.id,
                type: "http_error",
                status: upstream.status,
                statusText: upstream.statusText,
                body: errBody,
              });
              send({ id: item.id, type: "stream_end" });
              return;
            }

            const reader = upstream.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let idx: number;
              while ((idx = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line) continue;
                try {
                  const evt = JSON.parse(line) as Record<string, unknown>;
                  // The per-model route emits its own {type:"done"}; we rely on
                  // the reader closing plus our own stream_end sentinel instead.
                  if (evt.type === "done") continue;
                  send({ id: item.id, ...evt });
                } catch {
                  // ignore malformed lines
                }
              }
            }
            send({ id: item.id, type: "stream_end" });
          } catch (err: unknown) {
            if ((err as { name?: string })?.name === "AbortError") {
              send({ id: item.id, type: "stream_end" });
              return;
            }
            send({
              id: item.id,
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            });
            send({ id: item.id, type: "stream_end" });
          }
        })
      );

      closed = true;
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
