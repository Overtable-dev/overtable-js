/** Supported UI languages. Add a catalog file and register it in catalogs.ts to extend. */
export type Lang = "en" | "fr";

export const LANGS: readonly Lang[] = ["en", "fr"] as const;

export const DEFAULT_LANG: Lang = "en";

/**
 * The switch for French: LOCALES lists the languages Overtable serves, comma separated. The default is
 * English only (8 November 2026); LOCALES=en,fr turns French back on, for the app and the emails. Read at
 * call time. Stored choices (ot_lang cookie, account language) are never touched, only ignored while off.
 */
export function frenchEnabled(): boolean {
  return (process.env.LOCALES ?? "en").split(",").some((l) => l.trim().toLowerCase() === "fr");
}

export function isLang(value: string | null | undefined): value is Lang {
  return value === "en" || value === "fr";
}
