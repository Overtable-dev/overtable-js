import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  API_KEY_PREFIX,
  STANDARD_WEBHOOK_SECRET_PREFIX,
  WEBHOOK_SIGNATURE_VERSION,
  WEBHOOK_TOLERANCE_SECONDS,
} from "./constants.js";

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

/**
 * Constant-time check of a presented key against a stored hash.
 * Keys are 192-bit random values, so an unsalted SHA-256 is enough; the lookup
 * by hash already selects the row, this re-check is defense in depth.
 */
export function apiKeyMatchesHash(apiKey: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(apiKey), "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

const ENROLL_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A one-time code (backup code, operator recovery code): 100 random bits in 4 groups of 5,
 * easy to read out or type. The relay keeps its hash only.
 */
export function generateEnrollCode(): string {
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => ENROLL_ALPHABET[b & 31]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
}

/** Upper case, without separators, with the letters people confuse with digits mapped back. */
export function normalizeEnrollCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/**
 * 128 random bits: the code sits in a public URL, so it must not be guessable. Never starts
 * with "-", which command lines would read as an option.
 */
export function generateInviteCode(): string {
  for (;;) {
    const code = randomBytes(16).toString("base64url");
    if (!code.startsWith("-")) {
      return code;
    }
  }
}

export function generateId(): string {
  return randomUUID();
}

export function signWebhookBody(secret: string, timestamp: string, body: string): string {
  const payload = `${WEBHOOK_SIGNATURE_VERSION}.${timestamp}.${body}`;
  const digest = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return `${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}

/** A Standard Webhooks secret: `whsec_` and 32 random bytes in base64. */
export function generateStandardWebhookSecret(): string {
  return `${STANDARD_WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString("base64")}`;
}

/**
 * The HMAC key of a Standard Webhooks secret: the base64 bytes after `whsec_`. A secret
 * without the prefix (one a bot chose itself) is used as its UTF-8 bytes.
 */
export function standardWebhookKey(secret: string): Buffer {
  return secret.startsWith(STANDARD_WEBHOOK_SECRET_PREFIX)
    ? Buffer.from(secret.slice(STANDARD_WEBHOOK_SECRET_PREFIX.length), "base64")
    : Buffer.from(secret, "utf8");
}

/**
 * The webhook-signature value per Standard Webhooks: `v1,` and the base64 HMAC-SHA256 of
 * `<id>.<timestamp>.<body>`, keyed with standardWebhookKey.
 */
export function signStandardWebhook(secret: string, id: string, timestamp: string, body: string): string {
  return `v1,${createHmac("sha256", standardWebhookKey(secret)).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64")}`;
}

/** One signature per secret, space separated: during a rotation grace both secrets sign. */
export function signStandardWebhookAll(secrets: readonly string[], id: string, timestamp: string, body: string): string {
  return secrets.map((secret) => signStandardWebhook(secret, id, timestamp, body)).join(" ");
}

export interface StandardWebhookHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

/**
 * Receiver-side check of a Standard Webhooks call: the timestamp within the replay window
 * (5 minutes by default, either way) and one of the `v1,` signatures made with `secret`.
 * Drop a webhook-id you already processed: retries reuse it.
 */
export function verifyStandardWebhook(
  secret: string,
  headers: StandardWebhookHeaders,
  body: string,
  options: VerifyWebhookOptions = {},
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) {
    return false;
  }
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) {
    return false;
  }
  const expected = Buffer.from(signStandardWebhook(secret, id, timestamp, body));
  return signature.split(" ").some((candidate) => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
): boolean {
  const expected = signWebhookBody(secret, timestamp, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export interface VerifyWebhookOptions {
  toleranceSeconds?: number;
  nowMs?: number;
}

/**
 * Receiver-side check: valid signature and a timestamp within the replay window,
 * in either direction. Each retry is signed again with a fresh timestamp, so a
 * receiver should also drop a messageId it already processed.
 */
export function verifyWebhookRequest(
  secret: string,
  timestampHeader: string | undefined,
  body: string,
  signatureHeader: string | undefined,
  options: VerifyWebhookOptions = {},
): boolean {
  if (!timestampHeader || !signatureHeader || !/^\d{1,12}$/.test(timestampHeader)) {
    return false;
  }
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestampHeader)) > tolerance) {
    return false;
  }
  return verifyWebhookSignature(secret, timestampHeader, body, signatureHeader);
}

export function estimateImageBytes(data: string): number {
  if (data.startsWith("http://") || data.startsWith("https://")) {
    return Buffer.byteLength(data, "utf8");
  }
  const comma = data.indexOf(",");
  const raw = data.startsWith("data:") && comma >= 0 ? data.slice(comma + 1) : data;
  const padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((raw.length * 3) / 4) - padding);
}
