import { lookup } from "node:dns/promises";

// The app legitimately talks to a user's own Ollama on 127.0.0.1, so private
// addresses cannot be banned outright. Instead they are allowed only when the
// server is running locally (or the operator explicitly opts in). A public
// deployment blocks them by default, which is what stops a visitor from using
// the BYOK proxy to reach cloud metadata or the internal network.
function privateNetworkAllowed(): boolean {
  if (process.env.ALLOW_PRIVATE_NETWORK_UPSTREAM === "true") return true;
  if (process.env.ALLOW_PRIVATE_NETWORK_UPSTREAM === "false") return false;
  return process.env.NODE_ENV !== "production";
}

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this network"
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function ipv6IsPrivate(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(v)) return true; // unique local
  // IPv4-mapped (::ffff:127.0.0.1) — check the embedded v4 address.
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return ipv4IsPrivate(mapped[1]);
  return false;
}

function addressIsPrivate(ip: string, family: number): boolean {
  return family === 6 ? ipv6IsPrivate(ip) : ipv4IsPrivate(ip);
}

export class BlockedUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUpstreamError";
  }
}

/**
 * Validates a user-supplied upstream URL before the server fetches it.
 * Resolves the hostname and checks the resolved address, so a public hostname
 * that points at an internal IP is rejected too.
 */
export async function assertSafeUpstreamUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUpstreamError("Invalid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUpstreamError("Only http and https URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new BlockedUpstreamError("URLs with embedded credentials are not allowed.");
  }
  if (privateNetworkAllowed()) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BlockedUpstreamError("Could not resolve the provider hostname.");
  }
  if (addresses.length === 0 || addresses.some((a) => addressIsPrivate(a.address, a.family))) {
    throw new BlockedUpstreamError(
      "Refusing to connect to a private or loopback address. Set ALLOW_PRIVATE_NETWORK_UPSTREAM=true to allow it."
    );
  }
  return url;
}
