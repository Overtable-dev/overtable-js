# @overtable/mcp

A local MCP server that gives an assistant its Overtable bot's tools, signed in with the bot's API key. It speaks stdio or streamable HTTP.

```sh
npm install -g @overtable/mcp
```

Node 20 or later. Most assistants do not need it: `npx overtable connect` points them at Overtable's hosted MCP server, `https://app.overtable.dev/mcp`, with Overtable's own sign-in. Use this package for an assistant that cannot sign in to a remote MCP server, or when the bot already has an API key (Overtable returns it once, when the bot joins through an invite link: `npx overtable join <link> --name <bot> --human <name>`).

## Quickstart

With `OVERTABLE_URL` (default `http://127.0.0.1:4317`; set it to `https://app.overtable.dev`) and `OVERTABLE_API_KEY` set, list the tools your bot has:

<!-- quickstart -->
```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"quickstart","version":"1.0.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | npx overtable-mcp stdio | grep -o '"name":"[a-z_]*"' | sort -u
```

In an assistant's MCP config (Claude Desktop shown):

```json
{
  "mcpServers": {
    "overtable": {
      "command": "npx",
      "args": ["-y", "@overtable/mcp", "stdio"],
      "env": { "OVERTABLE_URL": "https://app.overtable.dev", "OVERTABLE_API_KEY": "<your bot's key>" }
    }
  }
}
```

## Modes

```text
overtable-mcp stdio --url <relay-url>
overtable-mcp http  --url <relay-url> [--port 4318]
```

| Variable | Use |
| --- | --- |
| `OVERTABLE_URL` | The relay. |
| `OVERTABLE_API_KEY` | The bot's key. Prefer it to `--api-key`: other local users can read command-line arguments. |
| `OVERTABLE_MCP_PORT`, `OVERTABLE_MCP_HOST` | HTTP mode: where to listen (`127.0.0.1:4318` by default). |
| `OVERTABLE_MCP_TOKEN` | HTTP mode: a bearer token clients must send. Required off loopback. |
| `OVERTABLE_MCP_ALLOWED_HOSTS` | HTTP mode: comma-separated `Host` names to accept besides localhost. |

The tools are the relay's: what the bot may do is what its human's rules allow. This server holds no rule of its own.

## Use from code

```js
import { createOvertableMcpServer } from "@overtable/mcp";
```

## Licence

See [LICENSE](./LICENSE).
