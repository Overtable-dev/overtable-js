import type { Agent } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name.toLowerCase()] ?? env[name.toUpperCase()];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

/**
 * NO_PROXY: comma or space separated. `*` matches everything; `example.com`,
 * `.example.com` and `*.example.com` match the host and its subdomains; an
 * optional `:port` restricts the entry to that port.
 */
function bypassesProxy(target: URL, noProxy: string | undefined): boolean {
  if (!noProxy) {
    return false;
  }
  const host = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = target.port || defaultPort(target.protocol);
  return noProxy
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") {
        return true;
      }
      // [v6]:port, host:port, or a bare host (a bare IPv6 address has several colons).
      const match =
        /^\[([^\]]+)\](?::(\d+))?$/.exec(entry) ??
        /^([^:]+):(\d+)$/.exec(entry) ??
        [entry, entry, undefined];
      const entryHost = (match[1] ?? "").replace(/^\*?\./, "").toLowerCase();
      const entryPort = match[2];
      if (!entryHost || (entryPort && entryPort !== port)) {
        return false;
      }
      return host === entryHost || host.endsWith(`.${entryHost}`);
    });
}

/**
 * Proxy for a target URL, read from the same variables as curl: HTTP_PROXY for
 * http targets, HTTPS_PROXY for https targets, ALL_PROXY as fallback for both,
 * lowercase names first, NO_PROXY honored. Returns undefined for a direct connection.
 */
export function proxyForUrl(target: string | URL, env: NodeJS.ProcessEnv): URL | undefined {
  const url = typeof target === "string" ? new URL(target) : target;
  if (bypassesProxy(url, envValue(env, "no_proxy"))) {
    return undefined;
  }
  const raw =
    (url.protocol === "https:" ? envValue(env, "https_proxy") : envValue(env, "http_proxy")) ??
    envValue(env, "all_proxy");
  if (!raw) {
    return undefined;
  }
  // curl treats a bare host:port as an http proxy.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    return new URL(withScheme);
  } catch {
    // Never echo the value: proxy URLs can carry credentials.
    throw new Error("Proxy variable is not a valid URL");
  }
}

export function agentFor(target: URL, proxy: URL | undefined): Agent | undefined {
  if (!proxy) {
    return undefined;
  }
  if (SocksProxyAgent.protocols.includes(proxy.protocol.slice(0, -1) as never)) {
    return new SocksProxyAgent(proxy);
  }
  if (proxy.protocol === "http:" || proxy.protocol === "https:") {
    return target.protocol === "https:" ? new HttpsProxyAgent(proxy) : new HttpProxyAgent(proxy);
  }
  throw new Error(`Unsupported proxy scheme ${proxy.protocol} (use http, https, socks4, socks5 or socks5h)`);
}

export interface HttpResponse {
  status: number;
  body: string;
  /** Lower-case header names; absent in transports that do not report them. */
  headers?: Record<string, string | string[] | undefined> | undefined;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

export const REQUEST_TIMEOUT_MS = 30_000;

/** node:http(s) with the proxy agent picked from env. Global fetch ignores proxy variables. */
export function nodeTransport(env: NodeJS.ProcessEnv, timeoutMs = REQUEST_TIMEOUT_MS): Transport {
  return (req) =>
    new Promise((resolve, reject) => {
      const target = new URL(req.url);
      const agent = agentFor(target, proxyForUrl(target, env));
      const send = target.protocol === "https:" ? httpsRequest : httpRequest;
      const headers: Record<string, string> = { ...req.headers };
      if (req.body !== undefined) {
        headers["content-length"] = String(Buffer.byteLength(req.body));
      }
      const outgoing = send(
        target,
        { method: req.method, headers, ...(agent ? { agent } : {}) },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              headers: res.headers,
            }),
          );
          res.on("error", reject);
        },
      );
      outgoing.setTimeout(timeoutMs, () =>
        outgoing.destroy(new Error(`No response after ${timeoutMs / 1000} s`)),
      );
      outgoing.on("error", reject);
      outgoing.end(req.body);
    });
}
