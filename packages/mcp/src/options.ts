import { brandedEnv, type EnvLike } from "@overtable/shared";

/** What overtable-mcp starts with: flags first, then OVERTABLE_* (or deprecated RELAIS_*) variables. */
export interface McpCliOptions {
  baseUrl: string;
  /** Undefined when neither --api-key nor the variable is set. */
  apiKey: string | undefined;
  port: number;
  host: string;
  authToken: string | undefined;
  allowedHosts: string[];
}

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) {
    return undefined;
  }
  return args[idx + 1];
}

export function mcpCliOptions(args: string[], env: EnvLike): McpCliOptions {
  return {
    baseUrl: argValue(args, "--url") ?? brandedEnv(env, "URL") ?? "http://127.0.0.1:4317",
    apiKey: argValue(args, "--api-key") ?? brandedEnv(env, "API_KEY"),
    port: Number(argValue(args, "--port") ?? brandedEnv(env, "MCP_PORT") ?? "4318"),
    host: brandedEnv(env, "MCP_HOST") ?? "127.0.0.1",
    authToken: brandedEnv(env, "MCP_TOKEN") || undefined,
    allowedHosts: (brandedEnv(env, "MCP_ALLOWED_HOSTS") ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  };
}
