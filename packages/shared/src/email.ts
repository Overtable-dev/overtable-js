/** RFC 5321 limits: 254 for the whole path, 64 for the local part. */
export const MAX_EMAIL_LENGTH = 254;
export const MAX_EMAIL_LOCAL_LENGTH = 64;

// A deliberately narrow subset of RFC 5322: dot-separated atoms of letters, digits and
// `_ % + -`. No quotes, spaces, commas, angle brackets or comments, so a stored address can
// never turn into a display name or a second recipient when a mailer parses it.
const LOCAL_PART = /^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*$/;
const DOMAIN_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
// Letters only, so IP literals and numeric hosts are refused.
const TOP_LEVEL_LABEL = /^[A-Za-z]{2,63}$/;

/**
 * Returns the address with its domain lowercased, or null when it is not a plain
 * `local@domain.tld` address.
 */
export function normalizeEmailAddress(raw: string): string | null {
  // Only spaces are trimmed: a newline or tab anywhere refuses the address.
  const value = raw.replace(/^ +| +$/g, "");
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) {
    return null;
  }
  const parts = value.split("@");
  if (parts.length !== 2) {
    return null;
  }
  const [local = "", rawDomain = ""] = parts;
  if (local.length > MAX_EMAIL_LOCAL_LENGTH || !LOCAL_PART.test(local)) {
    return null;
  }
  const domain = normalizeEmailDomain(rawDomain);
  return domain ? `${local}@${domain}` : null;
}

/** Returns the domain lowercased, or null when it is not a plain `name.tld` host name. */
export function normalizeEmailDomain(raw: string): string | null {
  const labels = raw.split(".");
  const tld = labels[labels.length - 1] ?? "";
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label)) || !TOP_LEVEL_LABEL.test(tld)) {
    return null;
  }
  return raw.toLowerCase();
}

/**
 * True when the part after the last `@` is one of `allowed` (lowercased domains), ignoring
 * case. Exact match only: `sub.example.com` does not match `example.com`. A null list
 * allows every domain.
 */
export function emailDomainAllowed(address: string, allowed: readonly string[] | null): boolean {
  if (allowed === null) {
    return true;
  }
  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  return allowed.includes(domain);
}

/**
 * The mailbox an address delivers to: lowercased, without a `+tag`. `name+overtable@x.com`
 * and `Name@X.com` both give `name@x.com`. Used to compare addresses, never to send.
 */
export function emailMailbox(address: string): string {
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at).toLowerCase();
  const plus = local.indexOf("+");
  return `${plus === -1 ? local : local.slice(0, plus)}@${address.slice(at + 1).toLowerCase()}`;
}

/**
 * The address for logs: first character of the local part, then `***@domain`.
 * `awa+overtable@x.com` gives `a***@x.com`. Not an address any more, so never sent to.
 */
export function maskEmailAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) {
    return "***";
  }
  return `${address[0]}***@${address.slice(at + 1).toLowerCase()}`;
}
