import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface Profile {
  version: 1;
  /** Relay base URL, without a trailing slash. */
  url: string;
  apiKey: string;
  botId: string;
  botName: string;
  humanName: string;
  /** Set only when the CLI generated the webhook secret itself. */
  webhookSecret?: string | undefined;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * CLI profile directory. Prefers OVERTABLE_HOME, then RELAIS_HOME.
 * Default: ~/.overtable, or ~/.relais when that directory already exists (existing installs).
 */
export function overtableHome(env: NodeJS.ProcessEnv): string {
  const preferred = env.OVERTABLE_HOME?.trim();
  if (preferred) return preferred;
  const legacy = env.RELAIS_HOME?.trim();
  if (legacy) return legacy;
  const root = env.HOME || homedir();
  const next = join(root, ".overtable");
  const prev = join(root, ".relais");
  if (!existsSync(next) && existsSync(prev)) {
    return prev;
  }
  return next;
}

/** @deprecated Use overtableHome. Kept so existing imports keep working. */
export const relaisHome = overtableHome;

/** The name becomes a file name, so it is restricted to keep it inside the profile home. */
export function assertProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) {
    throw new CliError(
      `Invalid profile name "${name}": use 1-32 lowercase letters, digits, - or _`,
      2,
    );
  }
  return name;
}

export function profilePath(env: NodeJS.ProcessEnv, name: string): string {
  return join(overtableHome(env), `${assertProfileName(name)}.json`);
}

/** http(s) only, no credentials (the API key travels in a header), no trailing slash. */
export function normalizeRelayUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError(`Invalid relay URL "${raw}"`, 2);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError("Relay URL must start with http:// or https://", 2);
  }
  if (url.username || url.password) {
    throw new CliError("Relay URL must not contain credentials", 2);
  }
  if (url.search || url.hash) {
    throw new CliError("Relay URL must not contain a query or fragment", 2);
  }
  return url.href.replace(/\/+$/, "");
}

export function profileExists(env: NodeJS.ProcessEnv, name: string): boolean {
  return existsSync(profilePath(env, name));
}

export function loadProfile(
  env: NodeJS.ProcessEnv,
  name: string,
  warn: (line: string) => void,
): Profile {
  const path = profilePath(env, name);
  if (!existsSync(path)) {
    throw new CliError(`No profile "${name}" at ${path}. Run: overtable register --profile ${name} ...`);
  }
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) {
    warn(`warning: ${path} is readable by other users (mode ${mode.toString(8)}). Run: chmod 600 ${path}`);
  }
  let parsed: Partial<Profile>;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Profile>;
  } catch {
    throw new CliError(`Profile ${path} is not valid JSON`);
  }
  if (!parsed.url || !parsed.apiKey || !parsed.botId) {
    throw new CliError(`Profile ${path} is missing url, apiKey or botId`);
  }
  return parsed as Profile;
}

/**
 * Directory 700, file 600. Written to a temp file first and renamed, so a crash
 * never leaves a half-written key file, and the mode is set before any content.
 */
export function saveProfile(env: NodeJS.ProcessEnv, name: string, profile: Profile): string {
  const dir = overtableHome(env);
  const path = profilePath(env, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = join(dir, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  return path;
}
