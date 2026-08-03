/** SSRF guard for the fetch endpoints. These routes fetch a client-supplied
 *  URL server-side; without this guard the Render box can be pointed at its
 *  own loopback, the private network, or the cloud metadata address. That is
 *  doubly unacceptable in a product that scores other people's infrastructure.
 *  assertPublicUrl rejects non-http(s) schemes and any host resolving to a
 *  private/loopback/reserved IP; safeFetch re-validates every redirect hop
 *  (redirect:"follow" would let a public URL 302 to an internal one).
 *
 *  Copied verbatim from stack-scanner/artifacts/api-server/src/lib/safe-url.ts
 *  (same guard, same DNS-rebinding fix) rather than reimplemented. */

import { lookup } from "node:dns/promises";
import * as net from "node:net";
import * as http from "node:http";
import * as https from "node:https";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
]);

export function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0 || a === 127) return true;
    if (a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true;
}

/** Validates the URL and returns it together with the exact address that was
 *  checked, so the caller can connect to THAT address rather than resolving
 *  again. Returning the address is what closes the rebinding window. */
export async function assertPublicUrlPinned(rawUrl: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) throw new Error("Blocked host");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("URL resolves to a non-public address");
    return { url: u, address: host, family: net.isIP(host) === 6 ? 6 : 4 };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("Could not resolve host");
  }
  if (!addrs.length) throw new Error("Could not resolve host");
  // EVERY address must be public. Checking only the first would let a host that
  // returns one public and one private address through.
  for (const { address } of addrs) {
    if (isPrivateIp(address)) throw new Error("URL resolves to a non-public address");
  }
  const chosen = addrs[0];
  return { url: u, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  return (await assertPublicUrlPinned(rawUrl)).url;
}

/** GET/HEAD a URL over a connection pinned to an already-validated IP.
 *
 *  Why this exists: `fetch(url)` performs its OWN DNS resolution, independent of
 *  the one the guard just checked. A hostname whose record flips between the two
 *  lookups (DNS rebinding, trivially done with a TTL-0 record) answers public to
 *  the check and private to the connection, so the guard passes and the request
 *  still lands inside the private network. Validating harder does not help; the
 *  only fix is to remove the second lookup.
 *
 *  The socket therefore goes to `address`, while the TLS servername and the Host
 *  header stay the real hostname so certificate validation and virtual hosting
 *  both behave normally. */
function fetchPinned(
  url: URL,
  address: string,
  family: 4 | 6,
  opts: { method: string; headers: Record<string, string>; timeoutMs: number },
): Promise<Response> {
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        // Connect to the validated address, never re-resolve the name.
        lookup: (_hostname: string, options: unknown, cb: unknown) => {
          const callback = cb as (err: NodeJS.ErrnoException | null, addr: unknown, fam?: number) => void;
          const all = (options as { all?: boolean } | undefined)?.all;
          if (all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        },
        host: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: opts.method,
        headers: { ...opts.headers, host: url.host },
        // Keep cert validation bound to the hostname, not the pinned IP.
        ...(isHttps ? { servername: url.hostname } : {}),
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (c: Buffer) => {
          bytes += c.length;
          // Bound the body so a hostile target cannot exhaust memory.
          if (bytes > 5_000_000) {
            req.destroy();
            reject(new Error("Response too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((one) => headers.append(k, one));
            else if (typeof v === "string") headers.set(k, v);
          }
          const status = res.statusCode ?? 502;
          const body = status === 204 || status === 304 || opts.method === "HEAD" ? null : Buffer.concat(chunks);
          const out = new Response(body, { status, headers });
          Object.defineProperty(out, "url", { value: url.toString(), enumerable: true });
          resolve(out);
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const { method = "GET", headers = {}, timeoutMs = 15_000, maxRedirects = 4 } = opts;
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { url: validated, address, family } = await assertPublicUrlPinned(current);
    const res = await fetchPinned(validated, address, family, { method, headers, timeoutMs });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, validated).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
