import { en, type MessageKey } from "./catalog-en.js";
import { fr } from "./catalog-fr.js";
import { deName } from "./de-name.js";
import { DEFAULT_LANG, type Lang } from "./types.js";

const CATALOGS: Record<Lang, Record<MessageKey, string>> = { en, fr };

export type { MessageKey };

export type MessageVars = Record<string, string | number>;

/**
 * Look up a UI string. Missing keys fall back to English, then to the key itself.
 * Placeholders use `{name}` syntax; `{de:name}` writes French "de" before it, elided or not.
 *
 * @example
 * t("auth.signinPasskey", "fr")
 * t("sheet.forBot", "en", { name: "Awa" })
 */
export function t(key: MessageKey, lang: Lang, vars?: MessageVars): string {
  const catalog = CATALOGS[lang] ?? CATALOGS[DEFAULT_LANG];
  let text = catalog[key] ?? CATALOGS.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{de:${name}}`, () => deName(String(value)));
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** True when both catalogs define the same keys (used by tests). */
export function catalogKeys(): MessageKey[] {
  return Object.keys(en) as MessageKey[];
}
