#!/usr/bin/env node
import { startHttpMcpServer } from "./http.js";
import { mcpCliOptions } from "./options.js";
import { startStdioServer } from "./stdio.js";

function usage(): never {
  console.error(`Usage:
  overtable-mcp stdio --url <relay-url> --api-key <key>
  overtable-mcp http  --url <relay-url> --api-key <key> [--port 4318]

Environment fallbacks: OVERTABLE_URL, OVERTABLE_API_KEY, OVERTABLE_MCP_PORT, OVERTABLE_MCP_HOST.
Each RELAIS_* name (RELAIS_URL, RELAIS_API_KEY, ...) still works when the OVERTABLE_* one is unset.
Prefer OVERTABLE_API_KEY over --api-key: command-line arguments are visible to other local users.
HTTP mode: OVERTABLE_MCP_TOKEN sets a bearer token clients must send (required off loopback).
OVERTABLE_MCP_ALLOWED_HOSTS: comma-separated Host names to accept besides localhost.`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (mode !== "stdio" && mode !== "http") {
    usage();
  }

  const options = mcpCliOptions(args, process.env);
  const { baseUrl, apiKey } = options;
  if (!apiKey) {
    console.error("Missing --api-key or OVERTABLE_API_KEY (RELAIS_API_KEY still works)");
    usage();
  }

  if (mode === "stdio") {
    await startStdioServer({ baseUrl, apiKey });
    return;
  }

  const running = await startHttpMcpServer({
    baseUrl,
    apiKey,
    port: options.port,
    host: options.host,
    authToken: options.authToken,
    allowedHosts: options.allowedHosts,
  });
  console.error(`Overtable MCP (streamable HTTP) on ${running.url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
