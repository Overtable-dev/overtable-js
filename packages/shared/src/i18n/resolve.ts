import { DEFAULT_LANG, isLang, type Lang } from "./types.js";

/**
 * Picks the best supported language from an Accept-Language header.
 * Quality values are respected; unsupported tags are skipped.
 */
export function langFromAcceptLanguage(header: string | null | undefined): Lang | null {
  if (!header?.trim()) {
    return null;
  }
  const parts = header.split(",").map((part) => {
    const [tag = "", ...params] = part.trim().split(";");
    const qParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith("q="));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
  });
  parts.sort((a, b) => b.q - a.q);
  for (const { tag, q } of parts) {
    if (q <= 0 || !tag) continue;
    const primary = tag.split("-")[0] ?? tag;
    if (isLang(primary)) {
      return primary;
    }
  }
  return null;
}

/**
 * Resolution order for human pages:
 * 1. Account preference (when signed in and saved)
 * 2. Explicit cookie from the FR/EN footer switch
 * 3. Accept-Language
 * 4. Default (en)
 */
export function resolveLang(opts: {
  account?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Lang {
  if (isLang(opts.account)) return opts.account;
  if (isLang(opts.cookie)) return opts.cookie;
  return langFromAcceptLanguage(opts.acceptLanguage) ?? DEFAULT_LANG;
}
