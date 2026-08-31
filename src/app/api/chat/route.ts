import { NextRequest } from "next/server";
import { OPENCODE_KNOWN_MODELS } from "@/lib/models";
import { assertSafeUpstreamUrl } from "@/lib/ssrf";

export const runtime = "nodejs";
// Streaming answers from slow models routinely exceed the 30s serverless default.
export const maxDuration = 120;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

type RequestBody = {
  model: string;
  messages: ChatMessage[];
  apiKey?: string;  opencodeApiKey?: string;
  bedrockApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaApiKey?: string;
  ollamaCloudBaseUrl?: string;
  customProviders?: Array<{ id: string; name: string; baseUrl: string; apiKey: string; models: string[] }>;
};

const GROQ_URL    = "https://api.groq.com/openai/v1/chat/completions";
const OPENCODE_URLS = [
  // api.opencode.ai currently returns a fake HTTP 200 with a plain-text
  // "Not Found" body for these paths instead of a real 404, so it must not
  // be tried first (see isLikelyStreamResponse below for the safety net).
  "https://opencode.ai/zen/v1/chat/completions",
  "https://api.opencode.ai/zen/v1/chat/completions",
  "https://api.opencode.ai/v1/chat/completions",
] as const;
const OPENCODE_PREFIX = "opencode/";
const BEDROCK_PREFIX = "bedrock/";
// Project-scoped "mantle" endpoint. Note .api.aws, and the plain /v1 path —
// the /openai/v1 variant exists but rejects these model ids.
const BEDROCK_URL = "https://bedrock-mantle.us-east-1.api.aws/v1/chat/completions";

// Guards against endpoints that return a "fake" HTTP 200 with a plain-text
// error body (e.g. "Not Found") instead of a real streaming response. A real
// chat-completions stream is always SSE or JSON, never bare text/html.
function isLikelyStreamResponse(res: Response): boolean {
  const contentType = res.headers.get("content-type") || "";
  return /event-stream|json/i.test(contentType);
}
const OLLAMA_PREFIX = "ollama/";
const CLOUD_OLLAMA_PREFIX = "ollama-cloud/";
const CUSTOM_PREFIX = "custom/";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_CLOUD_OLLAMA_BASE_URL = "https://ollama.com";

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

function resolveOllamaBaseUrl(raw?: string) {
  const input = (raw || DEFAULT_OLLAMA_BASE_URL).trim();
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Strip /v1 suffix — Ollama native API doesn't use it
    url.pathname = url.pathname.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function dataUrlToBase64(url: string): string | null {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) return null;
  return url.slice(comma + 1);
}

function dataUrlToMimeBase64(url: string): { mimeType: string; data: string } | null {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) return null;
  const meta = url.slice(5, comma);
  const mimeType = meta.split(";")[0] || "image/png";
  return { mimeType, data: url.slice(comma + 1) };
}

function textFromContent(content: ChatMessage["content"]) {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function toOllamaMessages(messages: ChatMessage[]): OllamaMessage[] {
  return messages.map((message) => {
    const out: OllamaMessage = {
      role: message.role,
      content: textFromContent(message.content),
    };
    if (Array.isArray(message.content)) {
      const images = message.content
        .filter((part) => part.type === "image_url")
        .map((part) => dataUrlToBase64(part.image_url.url))
        .filter((image): image is string => Boolean(image));
      if (images.length > 0) out.images = images;
    }
    return out;
  });
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { model, messages } = body;

  if (!model || !Array.isArray(messages) || messages.length === 0) {
    return new Response("Missing model or messages", { status: 400 });
  }

  // Custom OpenAI-compatible provider path (custom/<providerId>/<modelName>).
  if (model.startsWith(CUSTOM_PREFIX)) {
    const rest = model.slice(CUSTOM_PREFIX.length);
    const slash = rest.indexOf("/");
    const providerId = slash > 0 ? rest.slice(0, slash) : "";
    const customModel = slash > 0 ? rest.slice(slash + 1) : "";
    const provider = body.customProviders?.find((p) => p.id === providerId);
    if (!provider || !customModel) {
      return new Response("Unknown custom provider or model.", { status: 400 });
    }

    const base = provider.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(base)) return new Response("Invalid custom provider base URL.", { status: 400 });
    const endpoint = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
    try {
      await assertSafeUpstreamUrl(endpoint);
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 400 });
    }
    const key = provider.apiKey?.trim();

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ model: customModel, messages, stream: true }),
    }).catch((err: unknown) => {
      return new Response(
        `Custom provider unreachable at ${endpoint}. ${err instanceof Error ? err.message : String(err)}`,
        { status: 502 }
      );
    });

    if (upstream instanceof Response && upstream.status !== 200) {
      const errBody = await upstream.text().catch(() => `HTTP ${upstream.status}`);
      return new Response(errBody, { status: upstream.status });
    }
    const upstreamRes = upstream as Response;
    if (!upstreamRes.body) return new Response("No response body", { status: 502 });
    return streamOpenAiCompatible(upstreamRes);
  }

  if (model.startsWith(OLLAMA_PREFIX)) {
    const baseUrl = resolveOllamaBaseUrl(body.ollamaBaseUrl);
    if (!baseUrl) return new Response("Invalid Ollama base URL.", { status: 400 });
    try {
      await assertSafeUpstreamUrl(baseUrl);
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 400 });
    }

    const ollamaModel = model.slice(OLLAMA_PREFIX.length);
    if (!ollamaModel) return new Response("Missing Ollama model name.", { status: 400 });

    const ollamaKey = body.ollamaApiKey || process.env.OLLAMA_API_KEY;
    const upstream = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ollamaKey ? { Authorization: `Bearer ${ollamaKey}` } : {}),
      },
      body: JSON.stringify({
        model: ollamaModel,
        messages: toOllamaMessages(messages),
        stream: true,
      }),
    }).catch((err: unknown) => {
      return new Response(
        `Ollama is not reachable at ${baseUrl}. ${err instanceof Error ? err.message : String(err)}`,
        { status: 502 }
      );
    });

    if (upstream instanceof Response && upstream.status !== 200) {
      const errBody = await upstream.text().catch(() => `HTTP ${upstream.status}`);
      return new Response(errBody || `Ollama returned HTTP ${upstream.status}`, { status: upstream.status });
    }
    const upstreamRes = upstream as Response;
    if (!upstreamRes.body) return new Response("No response body", { status: 502 });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstreamRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let doneSent = false;
        let inThinking = false;
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

        try {
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
                type OllamaChunk = {
                  message?: { content?: string; thinking?: string };
                  done?: boolean;
                  done_reason?: string;
                  prompt_eval_count?: number;
                  eval_count?: number;
                };
                const json = JSON.parse(line) as OllamaChunk;
                const thinkingDelta = json.message?.thinking;
                const contentDelta = json.message?.content;

                // Close thinking block when content starts arriving
                if (inThinking && typeof contentDelta === "string" && contentDelta.length > 0) {
                  send({ type: "delta", text: "</think>\n" });
                  inThinking = false;
                }

                // Forward thinking tokens wrapped in <think> tags
                if (typeof thinkingDelta === "string" && thinkingDelta.length > 0) {
                  if (!inThinking) {
                    send({ type: "delta", text: "<think>" });
                    inThinking = true;
                  }
                  send({ type: "delta", text: thinkingDelta });
                }

                if (typeof contentDelta === "string" && contentDelta.length > 0) {
                  send({ type: "delta", text: contentDelta });
                }

                if (json.done) {
                  // Close any unclosed thinking block
                  if (inThinking) {
                    send({ type: "delta", text: "</think>\n" });
                    inThinking = false;
                  }
                  if (typeof json.prompt_eval_count === "number" || typeof json.eval_count === "number") {
                    send({
                      type: "usage",
                      usage: {
                        prompt_tokens: json.prompt_eval_count,
                        completion_tokens: json.eval_count,
                      },
                    });
                  }
                  if (json.done_reason) send({ type: "finish", reason: json.done_reason });
                  send({ type: "done" });
                  doneSent = true;
                }
              } catch {
                // ignore malformed stream lines
              }
            }
          }
        } catch (err: unknown) {
          send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
          if (!doneSent) send({ type: "done" });
          controller.close();
        }
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

  // Hosted Ollama path (ollama.com API models).
  if (model.startsWith(CLOUD_OLLAMA_PREFIX)) {
    const baseUrl = resolveOllamaBaseUrl(body.ollamaCloudBaseUrl || DEFAULT_CLOUD_OLLAMA_BASE_URL);
    if (!baseUrl) return new Response("Invalid Ollama API base URL.", { status: 400 });

    const cloudModel = model.slice(CLOUD_OLLAMA_PREFIX.length);
    if (!cloudModel) return new Response("Missing Ollama model name.", { status: 400 });

    const cloudKey = body.ollamaApiKey || process.env.OLLAMA_API_KEY;
    if (!cloudKey) return new Response("No Ollama API key. Add OLLAMA_API_KEY to .env.local or Settings.", { status: 401 });

    const upstream = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cloudKey}`,
      },
      body: JSON.stringify({
        model: cloudModel,
        messages: toOllamaMessages(messages),
        stream: true,
      }),
    }).catch((err: unknown) => {
      return new Response(
        `Ollama API is not reachable at ${baseUrl}. ${err instanceof Error ? err.message : String(err)}`,
        { status: 502 }
      );
    });

    if (upstream instanceof Response && upstream.status !== 200) {
      const errBody = await upstream.text().catch(() => `HTTP ${upstream.status}`);
      return new Response(errBody || `Ollama API returned HTTP ${upstream.status}`, { status: upstream.status });
    }
    const upstreamRes = upstream as Response;
    if (!upstreamRes.body) return new Response("No response body", { status: 502 });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstreamRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let doneSent = false;
        let inThinking = false;
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

        try {
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
                type OllamaChunk = {
                  message?: { content?: string; thinking?: string };
                  done?: boolean;
                  done_reason?: string;
                  prompt_eval_count?: number;
                  eval_count?: number;
                };
                const json = JSON.parse(line) as OllamaChunk;
                const thinkingDelta = json.message?.thinking;
                const contentDelta = json.message?.content;
                if (inThinking && typeof contentDelta === "string" && contentDelta.length > 0) {
                  send({ type: "delta", text: "</think>\n" });
                  inThinking = false;
                }
                if (typeof thinkingDelta === "string" && thinkingDelta.length > 0) {
                  if (!inThinking) { send({ type: "delta", text: "<think>" }); inThinking = true; }
                  send({ type: "delta", text: thinkingDelta });
                }
                if (typeof contentDelta === "string" && contentDelta.length > 0) {
                  send({ type: "delta", text: contentDelta });
                }
                if (json.done) {
                  if (inThinking) { send({ type: "delta", text: "</think>\n" }); inThinking = false; }
                  if (typeof json.prompt_eval_count === "number" || typeof json.eval_count === "number") {
                    send({ type: "usage", usage: { prompt_tokens: json.prompt_eval_count, completion_tokens: json.eval_count } });
                  }
                  if (json.done_reason) send({ type: "finish", reason: json.done_reason });
                  send({ type: "done" });
                  doneSent = true;
                }
              } catch { /* ignore malformed lines */ }
            }
          }
        } catch (err: unknown) {
          send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
          if (!doneSent) send({ type: "done" });
          controller.close();
        }
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


  // Amazon Bedrock via the project-scoped mantle endpoint (bedrock/<model-id>).
  if (model.startsWith(BEDROCK_PREFIX)) {
    const bedrockModel = model.slice(BEDROCK_PREFIX.length);
    if (!bedrockModel) return new Response("Missing Bedrock model name.", { status: 400 });

    const bedrockKey = body.bedrockApiKey || process.env.AWS_Bedrock_API_Key || process.env.AWS_BEDROCK_API_KEY;
    if (!bedrockKey) {
      return new Response("No Amazon Bedrock API key. Add AWS_Bedrock_API_Key to .env.local or Settings.", { status: 401 });
    }

    const upstream = await fetch(BEDROCK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": bedrockKey },
      body: JSON.stringify({ model: bedrockModel, messages, stream: true }),
    }).catch((err: unknown) => {
      return new Response(
        `Amazon Bedrock is unreachable. ${err instanceof Error ? err.message : String(err)}`,
        { status: 502 }
      );
    });

    if (upstream instanceof Response && upstream.status !== 200) {
      return new Response(await upstream.text().catch(() => `HTTP ${upstream.status}`), { status: upstream.status });
    }
    const bedrockRes = upstream as Response;
    if (!bedrockRes.body) return new Response("No response body", { status: 502 });
    return streamOpenAiCompatible(bedrockRes);
  }

  // OpenCode Zen gateway path (opencode/<model-name>).
  if (model.startsWith(OPENCODE_PREFIX)) {
    const opencodeModel = model.slice(OPENCODE_PREFIX.length);
    if (!opencodeModel) return new Response("Missing OpenCode model name.", { status: 400 });

    const opencodeKey = body.opencodeApiKey || process.env.OpenCode_API_Key || process.env.OPENCODE_API_KEY;
    if (!opencodeKey) {
      return new Response("No OpenCode API key. Add OpenCode_API_Key to .env.local or Settings.", { status: 401 });
    }

    let upstream: Response | null = null;
    let lastError: string | null = null;
    // The first entry is the only real endpoint; the rest are legacy mirrors
    // that answer with a fake 200. Keep the primary's error separately so a
    // genuine 429/503 from it is reported instead of a mirror's noise.
    let primaryError: string | null = null;
    let primaryStatus = 502;
    for (const url of OPENCODE_URLS) {
      try {
        // Only include reasoning_effort for models that support it
        const modelInfo = OPENCODE_KNOWN_MODELS[opencodeModel];
        const requestBody: {
          model: string;
          messages: ChatMessage[];
          stream: boolean;
          reasoning_effort?: string;
        } = { model: opencodeModel, messages, stream: true };
        if (modelInfo?.thinking) {
          // reasoning_effort asks reasoning-capable models (e.g. DeepSeek V4) to
          // think only as much as the prompt warrants instead of always running
          // a long chain-of-thought.
          requestBody.reasoning_effort = "low";
        }
        
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${opencodeKey}` },
          body: JSON.stringify(requestBody),
        });

        // Retry with the next endpoint for transient server failures, and also
        // for a "fake 200" — some stale OpenCode routes return HTTP 200 with a
        // plain-text "Not Found" body instead of a real error, which otherwise
        // silently produces a blank chat response.
        if (res.status >= 500) {
          lastError = `HTTP ${res.status} from ${url}`;
          if (url === OPENCODE_URLS[0]) {
            primaryError = await res.text().catch(() => "") || `OpenCode Zen returned HTTP ${res.status}.`;
            primaryStatus = res.status;
          }
          continue;
        }
        if (res.status === 200 && !isLikelyStreamResponse(res)) {
          lastError = `Unexpected non-stream response from ${url}`;
          continue;
        }

        upstream = res;
        break;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!upstream) {
      // Report what the real endpoint said, not whichever legacy mirror was
      // tried last — "unreachable" hid genuine rate-limit and outage errors.
      if (primaryError) {
        return new Response(primaryError, { status: primaryStatus });
      }
      return new Response(
        `OpenCode Zen is unreachable. ${lastError ?? "No healthy endpoint responded."}`,
        { status: 502 }
      );
    }

    if (upstream.status !== 200) {
      const errBody = await upstream.text().catch(() => `HTTP ${upstream.status}`);
      return new Response(errBody, { status: upstream.status });
    }
    if (!upstream.body) return new Response("No response body", { status: 502 });
    return streamOpenAiCompatible(upstream);
  }

  // OpenAI-compatible path (Groq only).
  const key = body.apiKey || process.env.GROQ_API_KEY;

  if (!key) {
    return new Response("No API key. Add your Groq API key in Settings.", { status: 401 });
  }

  // Strip internal "groq/" namespace prefix -> actual Groq API model name
  const groqModelId = model.replace(/^groq\//, "");

  const upstream = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: groqModelId, messages, stream: true }),
  }).catch((err: unknown) => {
    return new Response(`Upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`, { status: 502 });
  });

  if (upstream instanceof Response && upstream.status !== 200) {
    const errBody = await upstream.text().catch(() => `HTTP ${upstream.status}`);
    return new Response(errBody, { status: upstream.status });
  }
  const upstreamRes = upstream as Response;
  if (!upstreamRes.body) return new Response("No response body", { status: 502 });

  return streamOpenAiCompatible(upstreamRes);
}

// SSE (OpenAI-compatible) -> NDJSON. Shared by Groq and custom providers.
function streamOpenAiCompatible(upstreamRes: Response): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneSent = false;
      let inThinking = false;
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      const readTextParts = (value: unknown): string => {
        if (typeof value === "string") return value;
        if (!Array.isArray(value)) return "";
        return value
          .map((part) => {
            if (typeof part === "string") return part;
            if (!part || typeof part !== "object") return "";
            const p = part as { type?: string; text?: string };
            if (typeof p.text === "string") return p.text;
            return p.type === "text" && typeof p.text === "string" ? p.text : "";
          })
          .join("");
      };

      const forwardOpenAiLikeChunk = (json: unknown) => {
        if (!json || typeof json !== "object") return;
        const obj = json as {
          choices?: Array<{
            delta?: {
              content?: unknown;
              text?: unknown;
              reasoning?: unknown;
              reasoning_content?: unknown;
            };
            message?: { content?: unknown };
            text?: unknown;
            finish_reason?: string | null;
          }>;
          usage?: unknown;
        };

        const choice = obj.choices?.[0];
        const delta = choice?.delta;

        const contentText = readTextParts(delta?.content);
        const textDelta = readTextParts(delta?.text);
        const reasoningText = readTextParts(delta?.reasoning_content) || readTextParts(delta?.reasoning);
        const fallbackMessage =
          !contentText && !textDelta && !reasoningText ? readTextParts(choice?.message?.content) : "";
        const fallbackText =
          !contentText && !textDelta && !reasoningText && !fallbackMessage ? readTextParts(choice?.text) : "";

        // Close the thinking block once real content starts arriving.
        if (inThinking && (contentText || textDelta || fallbackMessage || fallbackText)) {
          send({ type: "delta", text: "</think>\n" });
          inThinking = false;
        }

        // Wrap reasoning tokens in <think> tags so the UI hides them behind a
        // collapsible "thinking" section instead of showing raw chain-of-thought.
        if (reasoningText) {
          if (!inThinking) {
            send({ type: "delta", text: "<think>" });
            inThinking = true;
          }
          send({ type: "delta", text: reasoningText });
        }

        if (contentText) send({ type: "delta", text: contentText });
        if (textDelta) send({ type: "delta", text: textDelta });
        if (fallbackMessage) send({ type: "delta", text: fallbackMessage });
        if (fallbackText) send({ type: "delta", text: fallbackText });

        if (obj.usage) send({ type: "usage", usage: obj.usage });
        const finish = choice?.finish_reason;
        if (finish) {
          if (inThinking) {
            send({ type: "delta", text: "</think>\n" });
            inThinking = false;
          }
          send({ type: "finish", reason: finish });
        }
      };

      const processPayload = (payload: string) => {
        const trimmed = payload.trim();
        if (!trimmed) return;
        if (trimmed === "[DONE]") {
          if (!doneSent) {
            send({ type: "done" });
            doneSent = true;
          }
          return;
        }
        try {
          forwardOpenAiLikeChunk(JSON.parse(trimmed));
        } catch {
          // ignore malformed chunks
        }
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            if (line.startsWith("data:")) {
              processPayload(line.slice(5));
              continue;
            }
            if (line.startsWith("event:") || line.startsWith(":")) continue;
            if (line.startsWith("{")) {
              // Some providers stream newline-delimited JSON instead of SSE.
              processPayload(line);
            }
          }
        }
        if (buffer.trim()) {
          const last = buffer.trim();
          if (last.startsWith("data:")) processPayload(last.slice(5));
          else if (last.startsWith("{")) processPayload(last);
        }
      } catch (err: unknown) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (inThinking) send({ type: "delta", text: "</think>\n" });
        if (!doneSent) send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
