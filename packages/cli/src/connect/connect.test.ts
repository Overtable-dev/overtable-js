import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../run.js";
import type { Transport } from "../transport.js";
import { ADAPTERS } from "./adapters.js";
import type { ConnectHooks } from "./index.js";
import { connectLang } from "./messages.js";

const RELAY = "https://relay.example.com";
const MCP = `${RELAY}/mcp`;

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ot-connect-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeTransport(opts: { token?: string } = {}): { transport: Transport; calls: string[] } {
  const calls: string[] = [];
  const transport: Transport = async (req) => {
    calls.push(`${req.method} ${req.url}`);
    const authed = req.headers["authorization"] === `Bearer ${opts.token}`;
    if (opts.token === undefined || !authed) return { status: 401, body: "{}" };
    if (req.url.endsWith("/v1/me")) return { status: 200, body: JSON.stringify({ botName: "Julien-bot", humanName: "Julien" }) };
    const body = req.body ? (JSON.parse(req.body) as { method?: string }) : {};
    if (body.method === "initialize") return { status: 200, body: "{}", headers: { "mcp-session-id": "s1" } };
    if (body.method === "tools/list") return { status: 200, body: JSON.stringify({ result: { tools: [{ name: "a" }, { name: "b" }] } }) };
    return { status: 202, body: "" };
  };
  return { transport, calls };
}

async function connect(args: string[], o: { env?: NodeJS.ProcessEnv; hooks?: ConnectHooks; transport?: Transport } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(["connect", "--url", RELAY, ...args], {
    env: { HOME: home, PATH: "", ...o.env },
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    transport: o.transport ?? fakeTransport().transport,
    connectHooks: o.hooks ?? {},
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const read = (p: string) => readFileSync(join(home, p), "utf8");
const backups = (dir: string) => readdirSync(join(home, dir)).filter((f) => f.includes(".bak-overtable-"));

describe("connect: Claude Code", () => {
  it("adds the server to ~/.claude.json and keeps the rest, with a backup", async () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ theme: "dark", mcpServers: { other: { type: "http", url: "https://o.test/mcp" } } }, null, 2), { mode: 0o640 });
    const r = await connect(["--harness", "claude-code", "--yes"]);
    expect(r.code).toBe(0);
    const json = JSON.parse(read(".claude.json"));
    expect(json.theme).toBe("dark");
    expect(json.mcpServers.other.url).toBe("https://o.test/mcp");
    expect(json.mcpServers.overtable).toEqual({ type: "http", url: MCP });
    expect(backups(".")).toHaveLength(1);
    expect(statSync(join(home, ".claude.json")).mode & 0o777).toBe(0o640);
    expect(r.out).toContain("sign in");
  });

  it("is idempotent: a second run writes nothing and makes no backup", async () => {
    await connect(["--harness", "claude", "--yes"]);
    const before = read(".claude.json");
    const r = await connect(["--harness", "claude", "--yes"]);
    expect(r.code).toBe(0);
    expect(read(".claude.json")).toBe(before);
    expect(backups(".")).toHaveLength(0);
    expect(r.out).toContain("already set up");
  });

  it("replaces another address on --yes, keeping other servers", async () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { overtable: { type: "http", url: "https://old.test/mcp" }, keep: { command: "x" } } }));
    await connect(["--harness", "claude-code", "--yes"]);
    const json = JSON.parse(read(".claude.json"));
    expect(json.mcpServers.overtable.url).toBe(MCP);
    expect(json.mcpServers.keep).toEqual({ command: "x" });
    expect(backups(".")).toHaveLength(1);
  });

  it("uses `claude mcp add` when claude is on PATH, after saving a copy", async () => {
    writeFileSync(join(home, ".claude.json"), "{}\n");
    const ran: string[] = [];
    const r = await connect(["--harness", "claude-code", "--yes"], {
      hooks: { which: (c) => (c === "claude" ? "/bin/claude" : undefined), exec: (c, a) => (ran.push(`${c} ${a.join(" ")}`), 0) },
    });
    expect(r.code).toBe(0);
    expect(ran).toEqual([`claude mcp add --transport http --scope user overtable ${MCP}`]);
    expect(backups(".")).toHaveLength(1);
  });

  it("refuses a file that is not plain JSON and prints the manual command", async () => {
    writeFileSync(join(home, ".claude.json"), "{ // comment\n}");
    const r = await connect(["--harness", "claude-code", "--yes"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("claude mcp add");
    expect(read(".claude.json")).toBe("{ // comment\n}");
  });
});

describe("connect: Codex", () => {
  const path = ".codex/config.toml";
  it("appends a table and keeps the other tables, CRLF included", async () => {
    mkdirSync(join(home, ".codex"));
    writeFileSync(join(home, path), 'model = "x"\r\n\r\n[mcp_servers.other]\r\nurl = "https://o.test"');
    await connect(["--harness", "codex", "--yes"]);
    const text = read(path);
    expect(text).toContain('model = "x"\r\n');
    expect(text).toContain('[mcp_servers.other]\r\nurl = "https://o.test"\r\n');
    expect(text).toContain(`[mcp_servers.overtable]\r\nurl = "${MCP}"\r\n`);
    expect(text).not.toMatch(/[^\r]\n/);
  });
  it("creates the file when missing, then does nothing on rerun", async () => {
    await connect(["--harness", "codex", "--yes"]);
    expect(read(path)).toBe(`[mcp_servers.overtable]\nurl = "${MCP}"\n`);
    const r = await connect(["--harness", "codex", "--yes"]);
    expect(r.out).toContain("already set up");
    expect(backups(".codex")).toHaveLength(0);
  });
  it("swaps the address in an existing table and keeps its other keys", async () => {
    mkdirSync(join(home, ".codex"));
    writeFileSync(join(home, path), `# mine\n[mcp_servers.overtable]\nurl = "https://old.test/mcp"\nstartup_timeout_sec = 20\n\n[profiles.x]\nmodel = "y"\n`);
    await connect(["--harness", "codex", "--yes"]);
    expect(read(path)).toBe(`# mine\n[mcp_servers.overtable]\nurl = "${MCP}"\nstartup_timeout_sec = 20\n\n[profiles.x]\nmodel = "y"\n`);
    expect(backups(".codex")).toHaveLength(1);
  });
  it("keeps a user key like bearer_token_env_var: same address means no change at all", async () => {
    mkdirSync(join(home, ".codex"));
    const text = `[mcp_servers.overtable]\nurl = "${MCP}"\nbearer_token_env_var = "MY_TOKEN"\n`;
    writeFileSync(join(home, path), text);
    const r = await connect(["--harness", "codex", "--yes"]);
    expect(r.out).toContain("already set up");
    expect(read(path)).toBe(text);
    expect(backups(".codex")).toHaveLength(0);
    writeFileSync(join(home, path), text.replace(MCP, "https://old.test/mcp"));
    await connect(["--harness", "codex", "--yes"]);
    expect(read(path)).toBe(text);
  });
  it("honours CODEX_HOME", async () => {
    const alt = join(home, "alt");
    await connect(["--harness", "codex", "--yes"], { env: { CODEX_HOME: alt } });
    expect(existsSync(join(alt, "config.toml"))).toBe(true);
    expect(existsSync(join(home, path))).toBe(false);
  });
  it("refuses an inline mcp_servers table", () => {
    expect(ADAPTERS.codex.plan('mcp_servers = { a = { url = "x" } }\n', MCP).status).toBe("unsupported");
  });
});

describe("connect: OpenClaw", () => {
  it("merges mcp.servers.overtable into openclaw.json", async () => {
    mkdirSync(join(home, ".openclaw"));
    writeFileSync(join(home, ".openclaw/openclaw.json"), JSON.stringify({ gateway: { port: 1 }, mcp: { servers: { a: { url: "https://a.test" } } } }));
    await connect(["--harness", "openclaw", "--yes"]);
    const json = JSON.parse(read(".openclaw/openclaw.json"));
    expect(json.gateway.port).toBe(1);
    expect(json.mcp.servers.a.url).toBe("https://a.test");
    expect(json.mcp.servers.overtable).toEqual({ url: MCP, transport: "streamable-http" });
  });
});

describe("connect: Hermes", () => {
  const path = ".hermes/config.yaml";
  it("creates the config, then reruns without change", async () => {
    await connect(["--harness", "hermes", "--yes"]);
    expect(read(path)).toBe(`mcp_servers:\n  overtable:\n    url: "${MCP}"\n    enabled: true\n`);
    const r = await connect(["--harness", "hermes", "--yes"]);
    expect(r.out).toContain("already set up");
  });
  it("adds a child under an existing mcp_servers and keeps the other keys", async () => {
    mkdirSync(join(home, ".hermes"));
    writeFileSync(join(home, path), 'model:\n  default: "m"\nmcp_servers:\n  other:\n    url: "https://o.test"\n    enabled: true\ntools:\n  x: 1\n');
    await connect(["--harness", "hermes", "--yes"]);
    expect(read(path)).toBe(`model:\n  default: "m"\nmcp_servers:\n  other:\n    url: "https://o.test"\n    enabled: true\n  overtable:\n    url: "${MCP}"\n    enabled: true\ntools:\n  x: 1\n`);
  });
  it("swaps only the url of an existing entry", async () => {
    mkdirSync(join(home, ".hermes"));
    writeFileSync(join(home, path), 'mcp_servers:\n  overtable:\n    url: "https://old.test/mcp"\n    timeout: 9\n');
    await connect(["--harness", "hermes", "--yes"]);
    expect(read(path)).toBe(`mcp_servers:\n  overtable:\n    url: "${MCP}"\n    timeout: 9\n`);
  });
  it("targets a named profile and rejects a bad profile name", async () => {
    await connect(["--harness", "hermes", "--hermes-profile", "work", "--yes"]);
    expect(existsSync(join(home, ".hermes/profiles/work/config.yaml"))).toBe(true);
    const bad = await connect(["--harness", "hermes", "--hermes-profile", "../x", "--yes"]);
    expect(bad.code).toBe(2);
  });
  it("turns a disabled entry back on", () => {
    const plan = ADAPTERS.hermes.plan(`mcp_servers:\n  overtable:\n    url: "${MCP}"\n    enabled: false\n`, MCP);
    expect(plan).toEqual({ status: "replace", next: `mcp_servers:\n  overtable:\n    url: "${MCP}"\n    enabled: true\n` });
  });
  it("refuses inline YAML", () => {
    expect(ADAPTERS.hermes.plan("mcp_servers: {a: {url: x}}\n", MCP).status).toBe("unsupported");
  });
});

describe("connect: flow", () => {
  it("--dry-run writes nothing and does not call the relay", async () => {
    const { transport, calls } = fakeTransport();
    const r = await connect(["--harness", "codex", "--dry-run"], { transport });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Dry run");
    expect(existsSync(join(home, ".codex"))).toBe(false);
    expect(calls).toEqual([]);
  });
  it("without a terminal and without --yes, exits 2 and writes nothing", async () => {
    const r = await connect(["--harness", "codex"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--yes");
    expect(existsSync(join(home, ".codex"))).toBe(false);
  });
  it("asks once, and a no writes nothing", async () => {
    const r = await connect(["--harness", "codex"], { hooks: { ask: async () => "n" } });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Cancelled");
    expect(existsSync(join(home, ".codex"))).toBe(false);
  });
  it("detects the only installed assistant", async () => {
    mkdirSync(join(home, ".codex"));
    const r = await connect(["--yes"]);
    expect(r.out).toContain("Assistant: Codex");
  });
  it("detects a harness from PATH", async () => {
    const r = await connect(["--yes"], { hooks: { which: (c) => (c === "hermes" ? "/bin/hermes" : undefined) } });
    expect(r.out).toContain("Assistant: Hermes");
  });
  it("with several or none found, and --yes, asks for --harness (exit 2)", async () => {
    expect((await connect(["--yes"])).code).toBe(2);
    mkdirSync(join(home, ".codex"));
    mkdirSync(join(home, ".hermes"));
    const r = await connect(["--yes"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--harness");
  });
  it("lets the person pick when several are found", async () => {
    mkdirSync(join(home, ".codex"));
    mkdirSync(join(home, ".hermes"));
    const answers = ["2", "y"];
    const r = await connect([], { hooks: { ask: async () => answers.shift() ?? "" } });
    expect(r.out).toContain("Assistant: Hermes");
  });
  it("rejects an unknown harness", async () => {
    expect((await connect(["--harness", "vim", "--yes"])).code).toBe(2);
  });
  it("opens the account page when sign-in is needed", async () => {
    const opened: string[] = [];
    const r = await connect(["--harness", "codex", "--yes"], { hooks: { openUrl: (u) => (opened.push(u), true) } });
    expect(opened).toEqual([`${RELAY}/app`]);
    expect(r.out).toContain("codex mcp login overtable");
  });
  it("with a token, lists tools and names the bot and its human, never the token", async () => {
    const { transport } = fakeTransport({ token: "tok-for-test-only" });
    const r = await connect(["--harness", "codex", "--yes"], { env: { OVERTABLE_API_KEY: "tok-for-test-only" }, transport });
    expect(r.out).toContain("Julien-bot");
    expect(r.out).toContain("Julien");
    expect(r.out).toContain("2 Overtable tools");
    expect(r.out + r.err).not.toContain("tok-for-test-only");
  });
  it("exits 1 when the address does not answer, but keeps the written setup", async () => {
    const transport: Transport = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const r = await connect(["--harness", "codex", "--yes"], { transport });
    expect(r.code).toBe(1);
    expect(r.err).toContain("ECONNREFUSED");
    expect(existsSync(join(home, ".codex/config.toml"))).toBe(true);
  });
  it("defaults to the Overtable app address", async () => {
    const out: string[] = [];
    await run(["connect", "--harness", "codex", "--dry-run"], { env: { HOME: home, PATH: "" }, stdout: (l) => out.push(l), stderr: () => {}, connectHooks: {} });
    expect(out.join("\n")).toContain("https://app.overtable.dev");
  });
  it("honours OVERTABLE_URL", async () => {
    const out: string[] = [];
    await run(["connect", "--harness", "codex", "--dry-run"], { env: { HOME: home, PATH: "", OVERTABLE_URL: "https://x.example.org/" }, stdout: (l) => out.push(l), stderr: () => {}, connectHooks: {} });
    expect(out.join("\n")).toContain("https://x.example.org");
  });
});

describe("connect: French", () => {
  it("speaks French from LANG, with vous and no long dash", async () => {
    const r = await connect(["--harness", "codex", "--yes"], { env: { LANG: "fr_FR.UTF-8" } });
    expect(r.out).toContain("C'est fait");
    expect(r.out).toContain("Ensuite");
    expect(r.out).not.toContain(String.fromCharCode(0x2014));
    const dry = await connect(["--harness", "hermes", "--dry-run"], { env: { LANG: "fr_FR.UTF-8" } });
    expect(dry.out).toContain("Simulation");
    const no = await connect(["--harness", "vim"], { env: { LC_ALL: "fr_FR.UTF-8" } });
    expect(no.err).toContain("Assistant inconnu");
  });
  it("picks the locale from LC_ALL, then LC_MESSAGES, then LANG", () => {
    expect(connectLang({ LC_ALL: "fr_FR", LANG: "en_US" })).toBe("fr");
    expect(connectLang({ LC_ALL: "C", LC_MESSAGES: "fr_CA", LANG: "en_US" })).toBe("fr");
    expect(connectLang({ LANG: "de_DE" })).toBe("en");
    expect(connectLang({})).toBe("en");
  });
});
