import { randomBytes } from "node:crypto";
import { generateStandardWebhookSecret, signStandardWebhook, signStandardWebhookAll, verifyStandardWebhook } from "@overtable/shared";
import { describe, expect, it } from "vitest";
import { assertWebhook, parseWebhook, SeenDeliveries, signWebhook, verifyWebhook, WebhookVerificationError, type WebhookFailure } from "./webhooks.js";

/**
 * The SDK's webhook check against what the relay signs: every delivery here is signed with the
 * relay's own code (signStandardWebhook in @overtable/shared, the signer of the partner webhooks
 * and the bots' wakes), and every verdict is compared with the relay's receiver-side check.
 */

const NOW = Date.parse("2026-11-07T10:00:00Z");
const TS = String(Math.floor(NOW / 1000));
const ID = "pwh_9f3c2a";
const BODY = JSON.stringify({
  type: "exchange_asked",
  id: ID,
  createdAt: "2026-11-07T10:00:00.000Z",
  partner: "collabnod",
  linkId: "6f0c",
  data: { exchange: { id: "x_1", pair: "slot", state: "asked", direction: "incoming", decision: null, createdAt: "2026-11-07T10:00:00.000Z", updatedAt: "2026-11-07T10:00:00.000Z" } },
  metadata: {},
});

function delivery(secret: string, overrides: Partial<{ id: string; timestamp: string; body: string; signature: string }> = {}) {
  const id = overrides.id ?? ID;
  const timestamp = overrides.timestamp ?? TS;
  const body = overrides.body ?? BODY;
  return { headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": overrides.signature ?? signStandardWebhook(secret, id, timestamp, body) }, body };
}

function failure(fn: () => void): WebhookFailure | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof WebhookVerificationError) return err.reason;
    throw err;
  }
}

/** The relay's own receiver-side verdict, for comparison. */
function relayVerdict(secret: string, headers: Record<string, string>, body: string, nowMs = NOW): boolean {
  return verifyStandardWebhook(secret, { id: headers["webhook-id"], timestamp: headers["webhook-timestamp"], signature: headers["webhook-signature"] }, body, { nowMs });
}

describe("webhooks: a delivery the relay signed", () => {
  const secret = generateStandardWebhookSecret();

  it("verifies and parses, from Node headers, Fetch Headers and the plain triple", () => {
    const { headers, body } = delivery(secret);
    expect(verifyWebhook(secret, headers, body, { nowMs: NOW })).toBe(true);
    expect(verifyWebhook(secret, new Headers(headers), body, { nowMs: NOW })).toBe(true);
    expect(verifyWebhook(secret, { id: ID, timestamp: TS, signature: headers["webhook-signature"] }, Buffer.from(body), { nowMs: NOW })).toBe(true);
    // Node lowercases names, other servers may not.
    expect(verifyWebhook(secret, { "Webhook-Id": ID, "Webhook-Timestamp": TS, "Webhook-Signature": headers["webhook-signature"] }, body, { nowMs: NOW })).toBe(true);
    const event = parseWebhook(secret, headers, body, { nowMs: NOW });
    expect(event).toMatchObject({ type: "exchange_asked", linkId: "6f0c", data: { exchange: { id: "x_1", pair: "slot" } } });
    expect(relayVerdict(secret, headers, body)).toBe(true);
  });

  it("signs exactly as the relay does", () => {
    for (let i = 0; i < 20; i++) {
      const s = generateStandardWebhookSecret();
      const id = `pwh_${randomBytes(6).toString("hex")}`;
      const body = JSON.stringify({ n: i, text: "é ✓  " });
      expect(signWebhook(s, id, TS, body)).toBe(signStandardWebhook(s, id, TS, body));
    }
  });

  it("accepts either signature during a secret rotation, and either secret on the receiver's side", () => {
    const next = generateStandardWebhookSecret();
    const signature = signStandardWebhookAll([secret, next], ID, TS, BODY);
    expect(signature.split(" ")).toHaveLength(2);
    const headers = { "webhook-id": ID, "webhook-timestamp": TS, "webhook-signature": signature };
    expect(verifyWebhook(secret, headers, BODY, { nowMs: NOW })).toBe(true);
    expect(verifyWebhook(next, headers, BODY, { nowMs: NOW })).toBe(true);
    // The receiver holds both secrets while it rotates; the relay signs with the new one only.
    const onlyNew = delivery(next);
    expect(verifyWebhook([secret, next], onlyNew.headers, onlyNew.body, { nowMs: NOW })).toBe(true);
  });
});

describe("webhooks: tampered or replayed deliveries are refused, as the relay refuses them", () => {
  const secret = generateStandardWebhookSecret();

  const cases: Array<{ name: string; make: () => { headers: Record<string, string>; body: string }; reason: WebhookFailure; nowMs?: number }> = [
    { name: "a body changed after signing", make: () => ({ ...delivery(secret), body: BODY.replace('"slot"', '"quote"') }), reason: "bad_signature" },
    { name: "one byte added to the body (whitespace)", make: () => ({ ...delivery(secret), body: `${BODY} ` }), reason: "bad_signature" },
    { name: "a body re-serialised (same JSON, other bytes)", make: () => ({ ...delivery(secret), body: JSON.stringify(JSON.parse(BODY), null, 2) }), reason: "bad_signature" },
    { name: "another webhook-id", make: () => ({ headers: { ...delivery(secret).headers, "webhook-id": "pwh_other" }, body: BODY }), reason: "bad_signature" },
    { name: "the timestamp moved by one second", make: () => ({ headers: { ...delivery(secret).headers, "webhook-timestamp": String(Number(TS) + 1) }, body: BODY }), reason: "bad_signature" },
    { name: "signed with another secret", make: () => delivery(generateStandardWebhookSecret()), reason: "bad_signature" },
    {
      name: "a flipped character in the signature",
      make: () => {
        const d = delivery(secret);
        const sig = d.headers["webhook-signature"];
        const i = 5;
        return { headers: { ...d.headers, "webhook-signature": `${sig.slice(0, i)}${sig[i] === "A" ? "B" : "A"}${sig.slice(i + 1)}` }, body: BODY };
      },
      reason: "bad_signature",
    },
    { name: "a v2 scheme label", make: () => ({ headers: { ...delivery(secret).headers, "webhook-signature": delivery(secret).headers["webhook-signature"].replace(/^v1,/, "v2,") }, body: BODY }), reason: "bad_signature" },
    { name: "an empty signature", make: () => ({ headers: { ...delivery(secret).headers, "webhook-signature": "" }, body: BODY }), reason: "missing_headers" },
    { name: "no webhook-id", make: () => ({ headers: { "webhook-timestamp": TS, "webhook-signature": delivery(secret).headers["webhook-signature"] }, body: BODY }), reason: "missing_headers" },
    { name: "a timestamp in milliseconds or with text", make: () => delivery(secret, { timestamp: `${TS}x` }), reason: "bad_timestamp" },
    { name: "a replay six minutes later", make: () => delivery(secret), reason: "stale_timestamp", nowMs: NOW + 6 * 60_000 },
    { name: "a timestamp six minutes in the future", make: () => delivery(secret), reason: "stale_timestamp", nowMs: NOW - 6 * 60_000 },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const { headers, body } = c.make();
      const nowMs = c.nowMs ?? NOW;
      expect(failure(() => assertWebhook(secret, headers, body, { nowMs }))).toBe(c.reason);
      expect(verifyWebhook(secret, headers, body, { nowMs })).toBe(false);
      expect(relayVerdict(secret, headers, body, nowMs)).toBe(false);
    });
  }

  it("keeps the window the caller sets, and the relay's 5 minutes by default", () => {
    const { headers, body } = delivery(secret);
    expect(verifyWebhook(secret, headers, body, { nowMs: NOW + 4 * 60_000 })).toBe(true);
    expect(verifyWebhook(secret, headers, body, { nowMs: NOW + 4 * 60_000, toleranceSeconds: 60 })).toBe(false);
  });

  it("refuses a signed body that is not an event, and a secret that is not one", () => {
    const signed = delivery(secret, { body: "[1,2]" });
    expect(failure(() => parseWebhook(secret, signed.headers, signed.body, { nowMs: NOW }))).toBe("bad_body");
    const notJson = delivery(secret, { body: "hello" });
    expect(failure(() => parseWebhook(secret, notJson.headers, notJson.body, { nowMs: NOW }))).toBe("bad_body");
    // A misconfigured secret is the partner's bug, not a bad delivery: it throws.
    expect(() => verifyWebhook("whsec_", delivery(secret).headers, BODY, { nowMs: NOW })).toThrow(WebhookVerificationError);
  });

  it("drops a webhook-id it already handled (a retry reuses the id)", () => {
    const seen = new SeenDeliveries(2);
    expect(seen.firstTime("a")).toBe(true);
    expect(seen.firstTime("a")).toBe(false);
    expect(seen.firstTime("b")).toBe(true);
    expect(seen.firstTime("c")).toBe(true);
    // Bounded: the oldest id is forgotten first.
    expect(seen.firstTime("a")).toBe(true);
    expect(seen.firstTime("c")).toBe(false);
  });
});
