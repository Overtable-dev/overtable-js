import type { Transport } from "../transport.js";

export type VerifyResult =
  | { state: "ok"; tools: number; bot?: { botName: string; humanName: string } }
  | { state: "signin" }
  | { state: "unreachable"; why: string }
  | { state: "unexpected"; status: number };

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

function parseRpc(body: string): { result?: Record<string, unknown> } | null {
  const text = body.trimStart().startsWith("event:") || body.includes("\ndata:") ? body.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "" : body;
  try {
    return JSON.parse(text) as { result?: Record<string, unknown> };
  } catch {
    return null;
  }
}

/**
 * Asks the MCP endpoint for its tools. Without a token the relay must answer 401: the address
 * is right and the human still has to sign in. With a token: initialize, tools/list, and
 * /v1/me to read the bot and its human.
 */
export async function verifyConnection(transport: Transport, relayUrl: string, token: string | undefined): Promise<VerifyResult> {
  const mcpUrl = `${relayUrl}/mcp`;
  const auth: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  try {
    const init = await transport({
      method: "POST",
      url: mcpUrl,
      headers: { ...JSON_HEADERS, ...auth },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "overtable-connect", version: "0.1.0" } },
      }),
    });
    if (init.status === 401 || init.status === 403) return { state: "signin" };
    if (init.status !== 200) return { state: "unexpected", status: init.status };
    const sessionRaw = init.headers?.["mcp-session-id"];
    const session = Array.isArray(sessionRaw) ? sessionRaw[0] : sessionRaw;
    const sessionHeader: Record<string, string> = session ? { "mcp-session-id": session } : {};
    await transport({
      method: "POST",
      url: mcpUrl,
      headers: { ...JSON_HEADERS, ...auth, ...sessionHeader },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    const list = await transport({
      method: "POST",
      url: mcpUrl,
      headers: { ...JSON_HEADERS, ...auth, ...sessionHeader },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    if (list.status !== 200) return { state: "unexpected", status: list.status };
    const tools = (parseRpc(list.body)?.result?.["tools"] as unknown[] | undefined)?.length ?? 0;
    if (tools === 0) return { state: "unexpected", status: list.status };
    const me = await transport({ method: "GET", url: `${relayUrl}/v1/me`, headers: { accept: "application/json", ...auth } });
    let bot: { botName: string; humanName: string } | undefined;
    if (me.status === 200) {
      try {
        const body = JSON.parse(me.body) as { botName?: unknown; humanName?: unknown };
        if (typeof body.botName === "string" && typeof body.humanName === "string") {
          bot = { botName: body.botName, humanName: body.humanName };
        }
      } catch {
        // The tools answered; the name is a bonus.
      }
    }
    return bot ? { state: "ok", tools, bot } : { state: "ok", tools };
  } catch (err) {
    return { state: "unreachable", why: err instanceof Error ? err.message : String(err) };
  }
}
