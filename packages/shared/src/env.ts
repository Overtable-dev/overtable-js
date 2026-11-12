/**
 * Environment names after the rename: OVERTABLE_<suffix> first, then the deprecated
 * RELAIS_<suffix>. An empty value counts as unset, so a compose file that forwards both names
 * with an empty default leaves the other one in charge. One helper for the CLI, the MCP server
 * and the relay's demo.
 */

export type EnvLike = Record<string, string | undefined>;

/** The two names of one variable, preferred first. */
export function brandedEnvKeys(suffix: string): [string, string] {
  return [`OVERTABLE_${suffix}`, `RELAIS_${suffix}`];
}

/** The value of OVERTABLE_<suffix>, else RELAIS_<suffix>; undefined when both are unset or empty. */
export function brandedEnv(env: EnvLike, suffix: string): string | undefined {
  for (const key of brandedEnvKeys(suffix)) {
    const raw = env[key];
    if (raw !== undefined && raw.trim() !== "") {
      return raw;
    }
  }
  return undefined;
}

/** The name that brandedEnv read, for messages; OVERTABLE_<suffix> when neither is set. */
export function brandedEnvName(env: EnvLike, suffix: string): string {
  for (const key of brandedEnvKeys(suffix)) {
    const raw = env[key];
    if (raw !== undefined && raw.trim() !== "") {
      return key;
    }
  }
  return brandedEnvKeys(suffix)[0];
}
