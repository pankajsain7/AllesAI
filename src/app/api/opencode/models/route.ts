import { NextRequest } from "next/server";

const OPENCODE_MODELS_URLS = [
  // api.opencode.ai currently returns a fake HTTP 200 with a plain-text
  // "Not Found" body for these paths instead of a real 404, so the known
  // working host must be tried first.
  "https://opencode.ai/zen/v1/models",
  "https://api.opencode.ai/zen/v1/models",
  "https://api.opencode.ai/v1/models",
] as const;

type OpenCodeModelsResponse = {
  data?: Array<{ id?: string }>;
};

export async function GET(req: NextRequest) {
  const apiKey =
    req.nextUrl.searchParams.get("apiKey") ||
    process.env.OpenCode_API_Key ||
    process.env.OPENCODE_API_KEY ||
    null;

  let upstream: Response | null = null;
  let lastError: string | null = null;
  for (const url of OPENCODE_MODELS_URLS) {
    try {
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      });

      // Retry on upstream gateway/server errors, or a "fake 200" plain-text
      // error body, with the next known endpoint.
      if (res.status >= 500) {
        lastError = `HTTP ${res.status} from ${url}`;
        continue;
      }
      const contentType = res.headers.get("content-type") || "";
      if (res.status === 200 && !/json/i.test(contentType)) {
        lastError = `Unexpected non-JSON response from ${url}`;
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
      `OpenCode Zen is not reachable. ${lastError ?? "No healthy endpoint responded."}`,
      { status: 502 }
    );
  }

  if (upstream.status !== 200) {
    const message = await upstream.text().catch(() => `HTTP ${upstream.status}`);
    return Response.json(
      { error: message || `OpenCode Zen returned HTTP ${upstream.status}` },
      { status: upstream.status }
    );
  }

  const json = (await upstream.json().catch(() => ({}))) as OpenCodeModelsResponse;
  const models = (json.data ?? [])
    .map((model) => ({ id: model.id ?? "" }))
    .filter((model) => model.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  return Response.json({ models });
}
