import { existsSync } from "node:fs";
import { join } from "node:path";

export type HarnessId = "claude-code" | "codex" | "openclaw" | "hermes";
export const HARNESS_IDS: HarnessId[] = ["claude-code", "codex", "openclaw", "hermes"];
export const SERVER_NAME = "overtable";

export interface PlanEnv {
  env: NodeJS.ProcessEnv;
  home: string;
  /** Hermes profile name (--hermes-profile). */
  hermesProfile?: string | undefined;
}

export type Plan =
  | { status: "unchanged" }
  | { status: "add" | "replace"; next: string }
  | { status: "unsupported"; why: string };

export interface Adapter {
  id: HarnessId;
  label: string;
  /** Command names looked up on PATH. */
  bins: string[];
  configPath(p: PlanEnv): string;
  /** Paths whose presence says the harness is installed. */
  markers(p: PlanEnv): string[];
  /** Pure: current file text (or null) in, plan out. Never touches the disk. */
  plan(existing: string | null, mcpUrl: string): Plan;
  /** Hand-written equivalent, shown when the file cannot be edited safely. */
  snippet(mcpUrl: string): string;
}

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function jsonPlan(existing: string | null, pick: (root: Record<string, unknown>) => unknown, put: (root: Record<string, unknown>) => void, same: (entry: unknown) => boolean): Plan {
  let root: Record<string, unknown> = {};
  let trailing = "\n";
  let eol = "\n";
  if (existing !== null && existing.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { status: "unsupported", why: "not a JSON object" };
      }
      root = parsed as Record<string, unknown>;
    } catch {
      return { status: "unsupported", why: "not plain JSON, maybe comments" };
    }
    trailing = /\r?\n$/.test(existing) ? "\n" : "";
    eol = eolOf(existing);
  }
  const entry = pick(root);
  if (entry !== undefined && same(entry)) return { status: "unchanged" };
  put(root);
  const text = (JSON.stringify(root, null, 2) + trailing).replace(/\n/g, eol);
  return { status: entry === undefined ? "add" : "replace", next: text };
}

function child(root: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = root[key];
  if (v === undefined) {
    const made: Record<string, unknown> = {};
    root[key] = made;
    return made;
  }
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

const claudeCode: Adapter = {
  id: "claude-code",
  label: "Claude Code",
  bins: ["claude"],
  configPath: (p) => join(p.home, ".claude.json"),
  markers: (p) => [join(p.home, ".claude.json"), join(p.home, ".claude")],
  plan(existing, mcpUrl) {
    let bad = false;
    const result = jsonPlan(
      existing,
      (root) => {
        const servers = root["mcpServers"];
        return servers && typeof servers === "object" ? (servers as Record<string, unknown>)[SERVER_NAME] : undefined;
      },
      (root) => {
        const servers = child(root, "mcpServers");
        if (!servers) {
          bad = true;
          return;
        }
        servers[SERVER_NAME] = { type: "http", url: mcpUrl };
      },
      (entry) => (entry as { url?: unknown; type?: unknown }).url === mcpUrl && (entry as { type?: unknown }).type === "http",
    );
    return bad ? { status: "unsupported", why: "mcpServers is not an object" } : result;
  },
  snippet: (mcpUrl) => `claude mcp add --transport http --scope user ${SERVER_NAME} ${mcpUrl}`,
};

const openclaw: Adapter = {
  id: "openclaw",
  label: "OpenClaw",
  bins: ["openclaw"],
  configPath: (p) => p.env["OPENCLAW_CONFIG_PATH"]?.trim() || join(p.env["OPENCLAW_STATE_DIR"]?.trim() || join(p.home, ".openclaw"), "openclaw.json"),
  markers: (p) => [p.env["OPENCLAW_STATE_DIR"]?.trim() || join(p.home, ".openclaw")],
  plan(existing, mcpUrl) {
    let bad = false;
    const result = jsonPlan(
      existing,
      (root) => {
        const mcp = root["mcp"] as { servers?: Record<string, unknown> } | undefined;
        return mcp?.servers && typeof mcp.servers === "object" ? mcp.servers[SERVER_NAME] : undefined;
      },
      (root) => {
        const mcp = child(root, "mcp");
        const servers = mcp && child(mcp, "servers");
        if (!servers) {
          bad = true;
          return;
        }
        servers[SERVER_NAME] = { url: mcpUrl, transport: "streamable-http" };
      },
      (entry) => (entry as { url?: unknown }).url === mcpUrl,
    );
    return bad ? { status: "unsupported", why: "mcp.servers is not an object" } : result;
  },
  snippet: (mcpUrl) => `"mcp": { "servers": { "${SERVER_NAME}": { "url": "${mcpUrl}", "transport": "streamable-http" } } }`,
};

const TOML_HEADER = /^\s*\[\s*mcp_servers\s*\.\s*(?:"overtable"|overtable)\s*\]\s*(?:#.*)?$/;

const codex: Adapter = {
  id: "codex",
  label: "Codex",
  bins: ["codex"],
  configPath: (p) => join(p.env["CODEX_HOME"]?.trim() || join(p.home, ".codex"), "config.toml"),
  markers: (p) => [p.env["CODEX_HOME"]?.trim() || join(p.home, ".codex")],
  plan(existing, mcpUrl) {
    const eol = existing ? eolOf(existing) : "\n";
    const block = [`[mcp_servers.${SERVER_NAME}]`, `url = ${JSON.stringify(mcpUrl)}`];
    if (existing === null || existing.trim() === "") {
      return { status: "add", next: block.join(eol) + eol };
    }
    if (/^\s*mcp_servers\s*=/m.test(existing) || /^\s*mcp_servers\s*\.\s*(?:"overtable"|overtable)\s*=/m.test(existing)) {
      return { status: "unsupported", why: "mcp_servers is written as an inline table" };
    }
    const lines = existing.split(/\r?\n/);
    const start = lines.findIndex((l) => TOML_HEADER.test(l));
    if (start < 0) {
      const sep = /\r?\n$/.test(existing) ? "" : eol;
      return { status: "add", next: existing + sep + eol + block.join(eol) + eol };
    }
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
    const body = lines.slice(start + 1, end);
    const urlLine = body.find((l) => /^\s*url\s*=/.test(l));
    const hasStdioKey = body.some((l) => /^\s*(command|args)\s*=/.test(l));
    if (urlLine && urlLine.replace(/\s+/g, "") === `url=${JSON.stringify(mcpUrl)}`.replace(/\s+/g, "") && !hasStdioKey) {
      return { status: "unchanged" };
    }
    // Keep the user's other keys (timeouts, enabled...) and swap the address.
    const kept = body.filter((l) => !/^\s*(url|command|args)\s*=/.test(l));
    while (kept.length && kept[kept.length - 1]!.trim() === "") kept.pop();
    const replaced = [lines[start]!, `url = ${JSON.stringify(mcpUrl)}`, ...kept, ...(end < lines.length ? [""] : [])];
    let next = [...lines.slice(0, start), ...replaced, ...lines.slice(end)].join(eol);
    if (/\r?\n$/.test(existing) && !/\r?\n$/.test(next)) next += eol;
    return next === existing ? { status: "unchanged" } : { status: "replace", next };
  },
  snippet: (mcpUrl) => `[mcp_servers.${SERVER_NAME}]\nurl = ${JSON.stringify(mcpUrl)}`,
};

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlankOrComment = (line: string): boolean => line.trim() === "" || line.trim().startsWith("#");

const hermes: Adapter = {
  id: "hermes",
  label: "Hermes",
  bins: ["hermes"],
  configPath(p) {
    const base = p.env["HERMES_HOME"]?.trim() || join(p.home, ".hermes");
    return p.hermesProfile ? join(base, "profiles", p.hermesProfile, "config.yaml") : join(base, "config.yaml");
  },
  markers: (p) => [p.env["HERMES_HOME"]?.trim() || join(p.home, ".hermes")],
  plan(existing, mcpUrl) {
    const eol = existing ? eolOf(existing) : "\n";
    const url = JSON.stringify(mcpUrl);
    const newChild = (pad: string, step: string) => [`${pad}${SERVER_NAME}:`, `${pad}${step}url: ${url}`, `${pad}${step}enabled: true`];
    if (existing === null || existing.trim() === "") {
      return { status: "add", next: ["mcp_servers:", ...newChild("  ", "  ")].join(eol) + eol };
    }
    const lines = existing.split(/\r?\n/);
    const top = lines.findIndex((l) => /^mcp_servers\s*:/.test(l));
    if (top < 0) {
      const sep = /\r?\n$/.test(existing) ? "" : eol;
      return { status: "add", next: existing + sep + ["mcp_servers:", ...newChild("  ", "  ")].join(eol) + eol };
    }
    if (!/^mcp_servers\s*:\s*(?:#.*)?$/.test(lines[top]!)) {
      return { status: "unsupported", why: "mcp_servers is written inline" };
    }
    let end = top + 1;
    while (end < lines.length && (isBlankOrComment(lines[end]!) || indentOf(lines[end]!) > 0)) end++;
    while (end > top + 1 && isBlankOrComment(lines[end - 1]!)) end--;
    const block = lines.slice(top + 1, end);
    const firstChild = block.find((l) => !isBlankOrComment(l));
    const pad = firstChild ? " ".repeat(indentOf(firstChild)) : "  ";
    const mine = block.findIndex((l) => l.startsWith(`${pad}${SERVER_NAME}:`) && indentOf(l) === pad.length);
    if (mine < 0) {
      const next = [...lines.slice(0, end), ...newChild(pad, "  "), ...lines.slice(end)].join(eol);
      return { status: "add", next };
    }
    let mineEnd = mine + 1;
    while (mineEnd < block.length && (isBlankOrComment(block[mineEnd]!) || indentOf(block[mineEnd]!) > pad.length)) mineEnd++;
    const entry = block.slice(mine, mineEnd);
    if (entry.length > 1 && entry[0]!.trim() !== `${SERVER_NAME}:`) {
      return { status: "unsupported", why: "the overtable entry is written inline" };
    }
    const urlIdx = entry.findIndex((l) => /^\s+url\s*:/.test(l));
    const current = urlIdx >= 0 ? entry[urlIdx]!.replace(/^\s+url\s*:\s*/, "").replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "") : null;
    const disabled = entry.some((l) => /^\s+enabled\s*:\s*(false|no|off)\b/i.test(l));
    if (current === mcpUrl && !disabled) return { status: "unchanged" };
    const step = entry[1] ? " ".repeat(indentOf(entry[1])) : `${pad}  `;
    const urlText = `${step}url: ${url}`;
    const swapped = urlIdx >= 0 ? entry.map((l, i) => (i === urlIdx ? urlText : l)) : [entry[0]!, urlText, ...entry.slice(1)];
    const newEntry = swapped.map((l) => (/^\s+enabled\s*:\s*(false|no|off)\b/i.test(l) ? l.replace(/(enabled\s*:\s*)\S+/i, "$1true") : l));
    const absStart = top + 1 + mine;
    const next = [...lines.slice(0, absStart), ...newEntry, ...lines.slice(top + 1 + mineEnd)].join(eol);
    return { status: "replace", next };
  },
  snippet: (mcpUrl) => `mcp_servers:\n  ${SERVER_NAME}:\n    url: ${JSON.stringify(mcpUrl)}\n    enabled: true`,
};

export const ADAPTERS: Record<HarnessId, Adapter> = { "claude-code": claudeCode, codex, openclaw, hermes };

export const HARNESS_ALIASES: Record<string, HarnessId> = { claude: "claude-code", "claude-code": "claude-code", codex: "codex", openclaw: "openclaw", hermes: "hermes" };

export function installedMarkers(adapter: Adapter, p: PlanEnv): boolean {
  return adapter.markers(p).some((m) => existsSync(m));
}
