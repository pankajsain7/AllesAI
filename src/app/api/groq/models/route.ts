import { NextRequest } from "next/server";

const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

// Exclude non-chat models (audio, moderation) from the browsable list.
const EXCLUDE_PATTERN = /whisper|tts|guard|moderation/i;

type GroqModelsResponse = {
  data?: Array<{ id?: string }>;
};

export async function GET(req: NextRequest) {
  const apiKey = req.nextUrl.searchParams.get("apiKey") || process.env.GROQ_API_KEY || null;
  if (!apiKey) {
    return Response.json({ error: "No Groq API key. Add it in Settings first." }, { status: 401 });
  }

  const upstream = await fetch(GROQ_MODELS_URL, {
    method: "GET",
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch((err: unknown) => {
    return new Response(
      `Groq is not reachable. ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 }
    );
  });

  if (upstream instanceof Response && upstream.status !== 200) {
    const message = await upstream.text().catch(() => `HTTP ${upstream.status}`);
    return Response.json(
      { error: message || `Groq returned HTTP ${upstream.status}` },
      { status: upstream.status }
    );
  }

  const json = (await (upstream as Response).json().catch(() => ({}))) as GroqModelsResponse;
  const models = (json.data ?? [])
    .map((model) => ({ id: model.id ?? "" }))
    .filter((model) => model.id && !EXCLUDE_PATTERN.test(model.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  return Response.json({ models });
}
