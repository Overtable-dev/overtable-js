import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Receiving Overtable's webhooks. The relay signs them per Standard
 * Webhooks, as it signs the bots' wakes: `webhook-signature` is `v1,` and the base64 HMAC-SHA256 of
 * `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the base64 bytes after `whsec_`. During
 * a secret rotation the header carries one signature per secret, space separated.
 *
 * Verify on the raw body, before parsing it, and drop a webhook-id you already handled: a retry
 * reuses the id with a fresh timestamp.
 */

/** Five minutes either way, as the relay's own receiver-side check (WEBHOOK_TOLERANCE_SECONDS). */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export type PartnerEventType =
  | "exchange_asked"
  | "exchange_answered"
  | "exchange_refused"
  | "exchange_released"
  | "decision_pending"
  | "decision_requested"
  | "receipt_signed"
  | "link_revoked";

/** What every exchange event carries: ids, states and kinds only, never parameters, answers or free text. */
export interface ExchangeRef {
  id: string;
  pair: string;
  state: string;
  direction: "incoming" | "outgoing";
  decision: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Envelope<T extends PartnerEventType, D> {
  type: T;
  /** The delivery id, also in the webhook-id header. */
  id: string;
  createdAt: string;
  /** The partner's slug. */
  partner: string;
  linkId: string | null;
  data: D;
}

export type PartnerEvent =
  | Envelope<"exchange_asked" | "exchange_answered" | "exchange_refused" | "exchange_released", { exchange: ExchangeRef }>
  | Envelope<"decision_pending", { exchange: ExchangeRef; waitsFor: "user"; decideAt?: string | null }>
  | Envelope<
      "decision_requested",
      {
        exchange: ExchangeRef;
        /** Typed parameters and the proposed answer, without any free-text field. */
        decision: { params: Record<string, unknown> | null; answer: Record<string, unknown> | null; why?: unknown; options?: unknown };
        decideAt?: string | null;
      }
    >
  | Envelope<"receipt_signed", { receipt: { id: string; verifyAt: string } }>
  | Envelope<"link_revoked", { link: { id: string; by: "user" | "partner" } }>;

/** The three headers, read case-insensitively from a Node, Fetch or plain-object header set. */
export interface WebhookHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

type HeaderSource = Headers | Record<string, string | string[] | undefined> | WebhookHeaders;

export interface VerifyWebhookOptions {
  /** Seconds the timestamp may be away from now, either way. 300 by default. */
  toleranceSeconds?: number;
  /** Tests: the receiver's clock, in ms. */
  nowMs?: number;
}

export type WebhookFailure = "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_signature" | "bad_secret" | "bad_body";

export class WebhookVerificationError extends Error {
  constructor(
    readonly reason: WebhookFailure,
    message: string,
  ) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

function pick(source: HeaderSource, name: string): string | undefined {
  if (typeof (source as Headers).get === "function") {
    return (source as Headers).get(name) ?? undefined;
  }
  const record = source as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === name) {
      return Array.isArray(value) ? (value[0] as string | undefined) : (value as string | undefined);
    }
  }
  return undefined;
}

/** The three Standard Webhooks headers from Node's IncomingHttpHeaders, a Fetch Headers or { id, timestamp, signature }. */
export function webhookHeaders(source: HeaderSource): WebhookHeaders {
  if ("id" in source && "timestamp" in source && "signature" in source && typeof (source as { get?: unknown }).get !== "function") {
    return source as WebhookHeaders;
  }
  return { id: pick(source, "webhook-id"), timestamp: pick(source, "webhook-timestamp"), signature: pick(source, "webhook-signature") };
}

/** The HMAC key of a `whsec_` secret: the base64 bytes after the prefix. */
export function webhookKey(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = Buffer.from(raw, "base64");
  if (key.length === 0) {
    throw new WebhookVerificationError("bad_secret", "The webhook secret is empty or not base64 (expected whsec_<base64>).");
  }
  return key;
}

/** `v1,<base64 HMAC-SHA256 of id.timestamp.body>`: what the relay puts in webhook-signature. */
export function signWebhook(secret: string, id: string, timestamp: string, body: string): string {
  return `v1,${createHmac("sha256", webhookKey(secret)).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64")}`;
}

/**
 * Checks one delivery and throws a WebhookVerificationError when it does not hold: the three
 * headers present, the timestamp within the window, one `v1,` signature made with `secret`.
 * `secrets` may list two during a rotation. `body` is the raw body as received, byte for byte.
 */
export function assertWebhook(secrets: string | readonly string[], headers: HeaderSource, body: string | Uint8Array, options: VerifyWebhookOptions = {}): void {
  const { id, timestamp, signature } = webhookHeaders(headers);
  if (!id || !timestamp || !signature) {
    throw new WebhookVerificationError("missing_headers", "webhook-id, webhook-timestamp and webhook-signature are required.");
  }
  if (!/^\d{1,12}$/.test(timestamp)) {
    throw new WebhookVerificationError("bad_timestamp", "webhook-timestamp must be whole seconds since the epoch.");
  }
  const tolerance = options.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) {
    throw new WebhookVerificationError("stale_timestamp", `webhook-timestamp is more than ${tolerance} s away from now.`);
  }
  const raw = typeof body === "string" ? body : Buffer.from(body).toString("utf8");
  const given = signature.split(" ").filter(Boolean);
  for (const secret of typeof secrets === "string" ? [secrets] : secrets) {
    const expected = Buffer.from(signWebhook(secret, id, timestamp, raw));
    if (given.some((candidate) => {
      const bytes = Buffer.from(candidate);
      return bytes.length === expected.length && timingSafeEqual(bytes, expected);
    })) {
      return;
    }
  }
  throw new WebhookVerificationError("bad_signature", "No webhook-signature matches this secret and body.");
}

/** True when the delivery holds; see assertWebhook. */
export function verifyWebhook(secrets: string | readonly string[], headers: HeaderSource, body: string | Uint8Array, options: VerifyWebhookOptions = {}): boolean {
  try {
    assertWebhook(secrets, headers, body, options);
    return true;
  } catch (err) {
    if (err instanceof WebhookVerificationError && err.reason !== "bad_secret") return false;
    throw err;
  }
}

/**
 * Verifies, then parses the event. Throws a WebhookVerificationError on a delivery that does not
 * hold or a body that is not an Overtable event.
 */
export function parseWebhook(secrets: string | readonly string[], headers: HeaderSource, body: string | Uint8Array, options: VerifyWebhookOptions = {}): PartnerEvent {
  assertWebhook(secrets, headers, body, options);
  let event: unknown;
  try {
    event = JSON.parse(typeof body === "string" ? body : Buffer.from(body).toString("utf8"));
  } catch {
    throw new WebhookVerificationError("bad_body", "The body is not JSON.");
  }
  if (!event || typeof event !== "object" || typeof (event as { type?: unknown }).type !== "string" || typeof (event as { data?: unknown }).data !== "object") {
    throw new WebhookVerificationError("bad_body", "The body is not an Overtable partner event.");
  }
  return event as PartnerEvent;
}

/**
 * Remembers the webhook-ids already handled, so a retry is dropped. In memory, bounded; a partner
 * with several processes keeps this set in its own database instead.
 */
export class SeenDeliveries {
  private readonly ids = new Set<string>();
  constructor(private readonly max = 10_000) {}

  /** True the first time an id is seen, false on a repeat. */
  firstTime(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.max) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }
}
