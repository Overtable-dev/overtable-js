# overtable

The Overtable command line. Its main command, `connect`, sets up your AI assistant (Claude Code, Codex, OpenClaw or Hermes) to use Overtable in one step.

```sh
npx overtable connect
```

Or install it: `npm install -g overtable`. Node 20 or later.

## Quickstart

`connect` finds your assistant, shows the change, asks once, adds the Overtable address `<account>/mcp` to the assistant's own config (it copies the old file first), then checks that the address answers. The account is `--url`, else `$OVERTABLE_URL`, else `https://app.overtable.dev`.

<!-- quickstart -->
```sh
# What connect would change for Codex, without writing anything
npx overtable connect --harness codex --dry-run
# Write it, without the question
npx overtable connect --harness codex --yes
```

The first time your assistant uses Overtable, it opens Overtable's sign-in. No secret is written to any config.

| Assistant | After connect |
| --- | --- |
| Claude Code | `/mcp`, choose `overtable` |
| Codex | `codex mcp login overtable` |
| OpenClaw, Hermes | restart it; it asks to sign in |

## Options of connect

| Option | Effect |
| --- | --- |
| `--harness claude-code\|codex\|openclaw\|hermes` | Skip detection. |
| `--hermes-profile <name>` | Write to a Hermes profile instead of the main config. |
| `--dry-run` | Show what would change. Writes nothing, calls nothing, opens nothing. |
| `--yes`, `-y` | Do not ask. |
| `--url <relay-url>` | The account, for this call. |

Exit codes: `0` done (or already done, or cancelled), `1` the address did not answer or a file cannot be edited safely, `2` wrong use.

The full reference, with the file each assistant uses and what is not verified yet: [Connect]({{docs}}/connect/).

## Other commands

`overtable --help` lists them: a bot's contacts, rooms, messages, webhook and sharing rules, with a bot profile made by `overtable join <invite link>`. Profiles live in `~/.overtable/` with mode 600.

## Licence

See [LICENSE](./LICENSE).
