import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { type RequestHandler } from "express";
import type { Server } from "node:http";
import { RelayClient } from "./relay-client.js";
import { createOvertableMcpServer } from "./server.js";

export interface HttpMcpOptions {
  baseUrl: string;
  apiKey: string;
  host?: string;
  port?: number;
  /**
   * Bearer token clients must send. Required when `host` is not loopback,
   * since anyone who reaches the endpoint acts as the bot.
   */
  authToken?: string | undefined;
  /** Extra Host header names to accept, besides localhost, 127.0.0.1 and [::1]. */
  allowedHosts?: string[] | undefined;
  /** Open sessions allowed at once. Defaults to DEFAULT_MAX_SESSIONS. */
  maxSessions?: number | undefined;
}

export const DEFAULT_MAX_SESSIONS = 32;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function requireBearer(token: string): RequestHandler {
  const expected = digest(token);
  return (req, res, next) => {
    const header = req.headers.authorization ?? "";
    const [scheme, presented] = header.split(" ");
    if (scheme?.toLowerCase() === "bearer" && presented && timingSafeEqual(digest(presented), expected)) {
      next();
      return;
    }
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
  };
}

export interface RunningHttpMcp {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Stateless-friendly streamable HTTP MCP endpoint at POST /mcp.
 * Each initialize creates a session; tools talk to Overtable with the configured bot key.
 */
export async function startHttpMcpServer(options: HttpMcpOptions): Promise<RunningHttpMcp> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4318;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  if (!LOOPBACK_HOSTS.has(host) && !options.authToken) {
    throw new Error(`Refusing to bind MCP HTTP on ${host} without an auth token (OVERTABLE_MCP_TOKEN, or RELAIS_MCP_TOKEN)`);
  }

  const app = express();
  // DNS rebinding: a web page that rebinds its own name to 127.0.0.1 would
  // otherwise drive this endpoint, and through it the bot's relay key.
  app.use(hostHeaderValidation(["localhost", "127.0.0.1", "[::1]", ...(options.allowedHosts ?? [])]));
  if (options.authToken) {
    app.use(requireBearer(options.authToken));
  }
  app.use(express.json({ limit: "2mb" }));

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        if (!isInitializeRequest(req.body)) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Missing session. Send initialize first." },
            id: null,
          });
          return;
        }
        if (transports.size >= maxSessions) {
          res.status(503).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Too many open sessions. Close one first." },
            id: null,
          });
          return;
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          },
        });

        transport.onclose = () => {
          const id = transport?.sessionId;
          if (id) {
            transports.delete(id);
          }
        };

        const client = new RelayClient({
          baseUrl: options.baseUrl,
          apiKey: options.apiKey,
        });
        const server = createOvertableMcpServer(client);
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session");
      return;
    }
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session");
      return;
    }
    await transport.handleRequest(req, res);
    transports.delete(sessionId!);
  });

  const httpServer: Server = await new Promise((resolve) => {
    const s = app.listen(port, host, () => resolve(s));
  });

  const address = httpServer.address();
  const bound =
    typeof address === "object" && address ? address.port : port;

  return {
    url: `http://${host}:${bound}/mcp`,
    port: bound,
    close: async () => {
      for (const t of transports.values()) {
        await t.close();
      }
      transports.clear();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
