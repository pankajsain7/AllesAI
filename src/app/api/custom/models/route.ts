import { NextRequest } from "next/server";
import { assertSafeUpstreamUrl } from "@/lib/ssrf";

type CustomModelsResponse = {
  data?: Array<{ id?: string } | string>;
  models?: Array<{ id?: string } | string>;
};

function resolveModelsEndpoint(raw: string): string | null {
  const base = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) return null;
  const root = base.replace(/\/chat\/completions$/, "");
  return `${root}/models`;
}

export async function GET(req: NextRequest) {
  const baseUrl = req.nextUrl.searchParams.get("baseUrl");
  if (!baseUrl) return Response.json({ error: "Missing baseUrl." }, { status: 400 });

  const endpoint = resolveModelsEndpoint(baseUrl);
  if (!endpoint) return Response.json({ error: "Invalid base URL." }, { status: 400 });
  try {
    await assertSafeUpstreamUrl(endpoint);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const apiKey = req.nextUrl.searchParams.get("apiKey") || null;

  const upstream = await fetch(endpoint, {
    method: "GET",
    cache: "no-store",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  }).catch((err: unknown) => {
    return new Response(
      `Provider is not reachable at ${endpoint}. ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 }
    );
  });

  if (upstream instanceof Response && upstream.status !== 200) {
    const message = await upstream.text().catch(() => `HTTP ${upstream.status}`);
    return Response.json(
      { error: message || `Provider returned HTTP ${upstream.status}` },
      { status: upstream.status }
    );
  }

  const json = (await (upstream as Response).json().catch(() => ({}))) as CustomModelsResponse;
  const raw = json.data ?? json.models ?? [];
  const models = raw
    .map((model) => (typeof model === "string" ? { id: model } : { id: model.id ?? "" }))
    .filter((model) => model.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  return Response.json({ models });
}
