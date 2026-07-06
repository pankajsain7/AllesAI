import { NextRequest } from "next/server";

const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiModelsResponse = {
  models?: Array<{
    name?: string;
    baseModelId?: string;
    supportedGenerationMethods?: string[];
  }>;
};

export async function GET(req: NextRequest) {
  const apiKey = req.nextUrl.searchParams.get("apiKey") || process.env.GEMINI_API_KEY || null;
  if (!apiKey) {
    return Response.json({ error: "No Gemini API key. Add it in Settings first." }, { status: 401 });
  }

  const upstream = await fetch(`${GEMINI_MODELS_URL}?pageSize=200`, {
    method: "GET",
    cache: "no-store",
    headers: { "x-goog-api-key": apiKey },
  }).catch((err: unknown) => {
    return new Response(
      `Gemini API is not reachable. ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 }
    );
  });

  if (upstream instanceof Response && upstream.status !== 200) {
    const message = await upstream.text().catch(() => `HTTP ${upstream.status}`);
    return Response.json(
      { error: message || `Gemini API returned HTTP ${upstream.status}` },
      { status: upstream.status }
    );
  }

  const json = (await (upstream as Response).json().catch(() => ({}))) as GeminiModelsResponse;
  const models = (json.models ?? [])
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => ({ id: model.baseModelId || (model.name ?? "").replace(/^models\//, "") }))
    .filter((model) => model.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  return Response.json({ models });
}
