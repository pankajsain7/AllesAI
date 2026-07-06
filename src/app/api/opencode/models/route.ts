import { NextRequest } from "next/server";

const OPENCODE_MODELS_URL = "https://opencode.ai/zen/v1/models";

type OpenCodeModelsResponse = {
  data?: Array<{ id?: string }>;
};

export async function GET(req: NextRequest) {
  const apiKey =
    req.nextUrl.searchParams.get("apiKey") ||
    process.env.OpenCode_API_Key ||
    process.env.OPENCODE_API_KEY ||
    null;

  const upstream = await fetch(OPENCODE_MODELS_URL, {
    method: "GET",
    cache: "no-store",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  }).catch((err: unknown) => {
    return new Response(
      `OpenCode Zen is not reachable. ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 }
    );
  });

  if (upstream instanceof Response && upstream.status !== 200) {
    const message = await upstream.text().catch(() => `HTTP ${upstream.status}`);
    return Response.json(
      { error: message || `OpenCode Zen returned HTTP ${upstream.status}` },
      { status: upstream.status }
    );
  }

  const json = (await (upstream as Response).json().catch(() => ({}))) as OpenCodeModelsResponse;
  const models = (json.data ?? [])
    .map((model) => ({ id: model.id ?? "" }))
    .filter((model) => model.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  return Response.json({ models });
}
