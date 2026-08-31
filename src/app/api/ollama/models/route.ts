import { NextRequest } from "next/server";
import { assertSafeUpstreamUrl } from "@/lib/ssrf";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    modified_at?: string;
    size?: number;
    digest?: string;
    details?: {
      format?: string;
      family?: string;
      families?: string[];
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
};


function resolveOllamaBaseUrl(raw?: string | null) {
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

export async function GET(req: NextRequest) {
  const baseUrl = resolveOllamaBaseUrl(req.nextUrl.searchParams.get("baseUrl"));
  if (!baseUrl) {
    return Response.json({ error: "Invalid Ollama base URL." }, { status: 400 });
  }
  try {
    await assertSafeUpstreamUrl(baseUrl);
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 400 });
  }

  const apiKey = req.nextUrl.searchParams.get("apiKey") || process.env.OLLAMA_API_KEY || null;

  const upstream = await fetch(`${baseUrl}/api/tags`, {
    method: "GET",
    cache: "no-store",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  }).catch((err: unknown) => {
    return new Response(
      `Ollama is not reachable at ${baseUrl}. ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 }
    );
  });

  if (upstream instanceof Response && upstream.status !== 200) {
    const message = await upstream.text().catch(() => `HTTP ${upstream.status}`);
    return Response.json({ error: message || `Ollama returned HTTP ${upstream.status}` }, { status: upstream.status });
  }

  const json = (await (upstream as Response).json().catch(() => ({}))) as OllamaTagsResponse;
  const models = (json.models ?? [])
    .map((model) => ({
      name: model.name ?? model.model ?? "",
      model: model.model ?? model.name ?? "",
      modifiedAt: model.modified_at,
      size: model.size,
      digest: model.digest,
      details: model.details,
    }))
    .filter((model) => model.name && model.model)
    .sort((a, b) => a.name.localeCompare(b.name));

  return Response.json({ models });
}
