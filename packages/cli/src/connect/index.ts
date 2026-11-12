import { homedir } from "node:os";
import { brandedEnv } from "@overtable/shared";
import { CliError, loadProfile, normalizeRelayUrl, profileExists } from "../profile.js";
import type { Transport } from "../transport.js";
import { ADAPTERS, HARNESS_ALIASES, HARNESS_IDS, SERVER_NAME, installedMarkers, type Adapter, type HarnessId, type PlanEnv } from "./adapters.js";
import { copyBackup, readIfExists, writeWithBackup } from "./files.js";
import { connectLang, say, type ConnectKey, type ConnectLang } from "./messages.js";
import { verifyConnection } from "./verify.js";

export const DEFAULT_ACCOUNT_URL = "https://app.overtable.dev";

/** Side effects of connect, injectable so tests never touch the real machine. */
export interface ConnectHooks {
  /** PATH lookup of a command; undefined when absent. */
  which?: (command: string) => string | undefined;
  /** Runs a command; returns its exit status. */
  exec?: (command: string, args: string[]) => number;
  /** One question, one line back. Absent means no terminal to ask. */
  ask?: (question: string) => Promise<string>;
  /** Opens a page in the browser; returns false if it could not. */
  openUrl?: (url: string) => boolean;
  now?: () => Date;
}

export interface ConnectOptions {
  harness?: string | undefined;
  hermesProfile?: string | undefined;
  url?: string | undefined;
  profile: string;
  dryRun: boolean;
  yes: boolean;
}

export interface ConnectIo {
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  transport: Transport;
  hooks: ConnectHooks;
}

const HERMES_PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function fail(lang: ConnectLang, key: ConnectKey, vars: Record<string, string | number> = {}, code = 2): never {
  throw new CliError(say(lang, key, vars), code);
}

function pickHarnessFlag(lang: ConnectLang, name: string): HarnessId {
  const id = HARNESS_ALIASES[name.trim().toLowerCase()];
  if (!id) fail(lang, "badHarness", { name, list: HARNESS_IDS.join(", ") });
  return id;
}

async function chooseHarness(io: ConnectIo, lang: ConnectLang, opts: ConnectOptions, p: PlanEnv): Promise<Adapter> {
  if (opts.harness) return ADAPTERS[pickHarnessFlag(lang, opts.harness)];
  const which = io.hooks.which ?? (() => undefined);
  const found = HARNESS_IDS.map((id) => ADAPTERS[id]).filter((a) => a.bins.some((b) => which(b)) || installedMarkers(a, p));
  const list = HARNESS_IDS.join("|");
  if (found.length === 1) return found[0]!;
  const options = found.length > 1 ? found : HARNESS_IDS.map((id) => ADAPTERS[id]);
  if (!io.hooks.ask || opts.yes) {
    return found.length > 1 ? fail(lang, "severalHarnesses", { list: found.map((a) => a.id).join(", ") }) : fail(lang, "noHarness", { list });
  }
  io.stdout(say(lang, "askHarness"));
  options.forEach((a, i) => io.stdout(`  ${i + 1}. ${a.label}`));
  const answer = (await io.hooks.ask("> ")).trim().toLowerCase();
  const byNumber = options[Number(answer) - 1];
  const byName = options.find((a) => a.id === HARNESS_ALIASES[answer] || a.label.toLowerCase() === answer);
  const chosen = byNumber ?? byName;
  if (!chosen) fail(lang, "badHarness", { name: answer, list });
  return chosen;
}

function nextStep(lang: ConnectLang, id: HarnessId): string {
  const key = { "claude-code": "nextClaude", codex: "nextCodex", openclaw: "nextOpenclaw", hermes: "nextHermes" } as const;
  return say(lang, key[id]);
}

/** A token from the environment or from a CLI profile on the same relay; never printed. */
function knownToken(env: NodeJS.ProcessEnv, relayUrl: string, profileName: string): string | undefined {
  const fromEnv = brandedEnv(env, "API_KEY")?.trim() || env["OVERTABLE_BOT_TOKEN"]?.trim();
  if (fromEnv) return fromEnv;
  try {
    if (profileExists(env, profileName)) {
      const profile = loadProfile(env, profileName, () => {});
      if (profile.url === relayUrl) return profile.apiKey;
    }
  } catch {
    // A broken profile must not stop connect.
  }
  return undefined;
}

export async function connect(io: ConnectIo, opts: ConnectOptions): Promise<void> {
  const lang = connectLang(io.env);
  const out = (key: ConnectKey, vars: Record<string, string | number> = {}) => io.stdout(say(lang, key, vars));
  if (opts.hermesProfile !== undefined && !HERMES_PROFILE.test(opts.hermesProfile)) {
    fail(lang, "badHermesProfile", { name: opts.hermesProfile });
  }
  const relayUrl = normalizeRelayUrl(opts.url ?? brandedEnv(io.env, "URL") ?? DEFAULT_ACCOUNT_URL);
  const mcpUrl = `${relayUrl}/mcp`;
  const planEnv: PlanEnv = { env: io.env, home: io.env["HOME"]?.trim() || homedir(), hermesProfile: opts.hermesProfile };

  const adapter = await chooseHarness(io, lang, opts, planEnv);
  const path = adapter.configPath(planEnv);
  out("found", { harness: adapter.label });
  out("relay", { url: relayUrl });

  const existing = readIfExists(path);
  const plan = adapter.plan(existing, mcpUrl);

  if (plan.status === "unsupported") {
    out("unsupported", { path, why: plan.why });
    io.stdout(adapter.snippet(mcpUrl));
    throw new CliError("", 1);
  }

  const useCli = adapter.id === "claude-code" && Boolean(io.hooks.which?.("claude") && io.hooks.exec);
  const claudeAdd = ["mcp", "add", "--transport", "http", "--scope", "user", SERVER_NAME, mcpUrl];
  const claudeRemove = ["mcp", "remove", "--scope", "user", SERVER_NAME];

  if (plan.status === "unchanged") {
    out("alreadyDone", { path });
  } else {
    out(plan.status === "add" ? "willAdd" : "willReplace", { path });
    if (useCli) out("willRun", { command: `claude ${claudeAdd.join(" ")}` });
    if (opts.dryRun) {
      out("dryRun");
      return;
    }
    if (!opts.yes) {
      if (!io.hooks.ask) fail(lang, "needYes");
      const answer = (await io.hooks.ask(`${say(lang, "confirm")} [${lang === "fr" ? "O/n" : "Y/n"}] `)).trim().toLowerCase();
      if (!["", "y", "yes", "o", "oui"].includes(answer)) {
        out("cancelled");
        return;
      }
    }
    const now = (io.hooks.now ?? (() => new Date()))();
    let backup: string | null = null;
    if (useCli) {
      // A running Claude Code owns ~/.claude.json: let its own command do the write, keep a copy first.
      if (existing !== null) backup = copyBackup(path, now);
      if (plan.status === "replace") io.hooks.exec!("claude", claudeRemove);
      if (io.hooks.exec!("claude", claudeAdd) !== 0) {
        throw new CliError(`claude mcp add failed. Add it by hand:\n${adapter.snippet(mcpUrl)}`, 1);
      }
    } else {
      backup = writeWithBackup(path, plan.next, now);
    }
    if (backup) out("backup", { path: backup });
    out("written", { path });
  }

  const token = knownToken(io.env, relayUrl, opts.profile);
  const result = await verifyConnection(io.transport, relayUrl, token);
  switch (result.state) {
    case "ok":
      if (result.bot) out("connectedAs", { bot: result.bot.botName, human: result.bot.humanName });
      out("toolsOk", { count: result.tools });
      return;
    case "signin": {
      out("signInNeeded");
      const account = `${relayUrl}/app`;
      const opened = io.hooks.openUrl?.(account) ?? false;
      if (!opened) out("signInOpen", { url: account });
      io.stdout(nextStep(lang, adapter.id));
      return;
    }
    case "unreachable":
      throw new CliError(say(lang, "unreachable", { url: relayUrl, why: result.why }), 1);
    case "unexpected":
      throw new CliError(say(lang, "badAnswer", { url: mcpUrl, status: result.status }), 1);
  }
}
