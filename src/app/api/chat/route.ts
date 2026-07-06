import { NextRequest } from "next/server";

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
  apiKey?: string;
  geminiApiKey?: string;
  opencodeApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaApiKey?: string;
  ollamaCloudBaseUrl?: string;
  customProviders?: Array<{ id: string; name: string; baseUrl: string; apiKey: string; models: string[] }>;
};

const GROQ_URL    = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENCODE_URLS = [
  "https://api.opencode.ai/zen/v1/chat/completions",
  "https://api.opencode.ai/v1/chat/completions",
  "https://opencode.ai/zen/v1/chat/completions",
] as const;
const OPENCODE_PREFIX = "opencode/";
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

// Convert OpenAI-style messages to Gemini native format
function toGeminiBody(messages: ChatMessage[]) {
  const systemParts: Array<{ text: string }> = [];
  const contents: Array<{
    role: string;
    parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }>;
  }> = [];

  for (const m of messages) {
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content : m.content.map(p => p.type === "text" ? p.text : "").join("");
      if (text) systemParts.push({ text });
    } else {
      const role = m.role === "assistant" ? "model" : "user";
      const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> =
        typeof m.content === "string"
          ? [{ text: m.content }]
          : m.content
              .map((p) => {
                if (p.type === "text") return p.text ? { text: p.text } : null;
                const image = dataUrlToMimeBase64(p.image_url.url);
                return image
                  ? { inline_data: { mime_type: image.mimeType, data: image.data } }
                  : null;
              })
              .filter((p): p is { text: string } | { inline_data: { mime_type: string; data: string } } => Boolean(p));
      if (parts.length > 0) contents.push({ role, parts });
    }
  }

  return {
    ...(systemParts.length > 0 ? { system_instruction: { parts: systemParts } } : {}),
    contents,
    generationConfig: { temperature: 0.7 },
  };
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

  // Gemini native API path.
  if (model.startsWith("gemini")) {
    const key = body.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!key) return new Response("No API key. Add your Gemini API key in Settings.", { status: 401 });

    const geminiUrl = `${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse`;
    const upstream = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(toGeminiBody(messages)),
    }).catch((err: unknown) => {
      return new Response(`Upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`, { status: 502 });
    });

    if (upstream instanceof Response && upstream.status !== 200) {
      const errBody = await upstream.text().catch(() => `HTTP ${upstream.status}`);
      return new Response(errBody, { status: upstream.status });
    }
    const upstreamRes = upstream as Response;
    if (!upstreamRes.body) return new Response("No response body", { status: 502 });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstreamRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
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
              if (!line || !line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                type GeminiChunk = {
                  candidates?: Array<{
                    content?: { parts?: Array<{ text?: string }> };
                    finishReason?: string;
                    groundingMetadata?: {
                      webSearchQueries?: string[];
                      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
                    };
                  }>;
                };
                const json = JSON.parse(payload) as GeminiChunk;
                const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (typeof text === "string" && text.length > 0) send({ type: "delta", text });
                const finish = json?.candidates?.[0]?.finishReason;
                if (finish && finish !== "STOP") send({ type: "finish", reason: finish });
                const gm = json?.candidates?.[0]?.groundingMetadata;
                if (gm) {
                  const queries = gm.webSearchQueries ?? [];
                  const sources = (gm.groundingChunks ?? [])
                    .filter((c) => c.web?.uri)
                    .map((c) => ({ title: c.web!.title ?? c.web!.uri!, uri: c.web!.uri! }));
                  if (queries.length > 0 || sources.length > 0) {
                    send({ type: "grounding", queries, sources });
                  }
                }
              } catch { /* ignore */ }
            }
          }
        } catch (err: unknown) {
          send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
          send({ type: "done" });
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
    for (const url of OPENCODE_URLS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${opencodeKey}` },
          body: JSON.stringify({ model: opencodeModel, messages, stream: true }),
        });

        // Retry with the next endpoint only for transient upstream/server failures.
        if (res.status >= 500) {
          lastError = `HTTP ${res.status} from ${url}`;
          continue;
        }

        upstream = res;
        break;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!upstream) {
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
            if (!line || !line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") { send({ type: "done" }); continue; }
            try {
              const json = JSON.parse(payload);
              const delta = json?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) send({ type: "delta", text: delta });
              if (json?.usage) send({ type: "usage", usage: json.usage });
              const finish = json?.choices?.[0]?.finish_reason;
              if (finish) send({ type: "finish", reason: finish });
            } catch { /* ignore */ }
          }
        }
      } catch (err: unknown) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
