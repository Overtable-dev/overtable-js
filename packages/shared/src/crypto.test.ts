import { describe, expect, it } from "vitest";
import {
  apiKeyMatchesHash,
  estimateImageBytes,
  generateApiKey,
  generateEnrollCode,
  generateInviteCode,
  generateStandardWebhookSecret,
  hashApiKey,
  normalizeEnrollCode,
  signStandardWebhook,
  signStandardWebhookAll,
  signWebhookBody,
  standardWebhookKey,
  verifyStandardWebhook,
  verifyWebhookRequest,
  verifyWebhookSignature,
} from "./crypto.js";

describe("crypto helpers", () => {
  it("makes invite codes that never start with a dash, which a command line reads as an option", () => {
    for (let i = 0; i < 2000; i++) {
      expect(generateInviteCode()).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_-]{21}$/);
    }
  });

  it("makes enrollment codes of 100 random bits that survive case, spaces and look-alike letters", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = generateEnrollCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
      codes.add(code);
      expect(normalizeEnrollCode(` ${code.toLowerCase().replace(/-/g, " ")} `)).toBe(code.replace(/-/g, ""));
    }
    expect(codes.size).toBe(500);
    expect(normalizeEnrollCode("0O1IL-abc")).toBe("00111ABC");
  });

  it("hashes api keys deterministically", () => {
    const key = generateApiKey();
    expect(key.startsWith("rl_")).toBe(true);
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toBe(hashApiKey(`${key}x`));
  });

  it("signs and verifies webhook bodies", () => {
    const body = JSON.stringify({ ok: true });
    const ts = "1710000000";
    const sig = signWebhookBody("secret-at-least-16", ts, body);
    expect(verifyWebhookSignature("secret-at-least-16", ts, body, sig)).toBe(true);
    expect(verifyWebhookSignature("secret-at-least-16", ts, `${body} `, sig)).toBe(false);
  });

  it("compares api key hashes in constant time", () => {
    const key = generateApiKey();
    expect(apiKeyMatchesHash(key, hashApiKey(key))).toBe(true);
    expect(apiKeyMatchesHash(`${key}x`, hashApiKey(key))).toBe(false);
    expect(apiKeyMatchesHash(key, "short")).toBe(false);
  });

  it("rejects webhook requests outside the replay window", () => {
    const secret = "secret-at-least-16";
    const body = JSON.stringify({ ok: true });
    const nowMs = 1_710_000_000_000;
    const ts = String(nowMs / 1000);
    const sig = signWebhookBody(secret, ts, body);

    expect(verifyWebhookRequest(secret, ts, body, sig, { nowMs })).toBe(true);
    expect(verifyWebhookRequest(secret, ts, body, sig, { nowMs: nowMs + 299_000 })).toBe(true);
    expect(verifyWebhookRequest(secret, ts, body, sig, { nowMs: nowMs + 301_000 })).toBe(false);
    expect(verifyWebhookRequest(secret, ts, body, sig, { nowMs: nowMs - 301_000 })).toBe(false);
    expect(
      verifyWebhookRequest(secret, ts, body, sig, { nowMs: nowMs + 30_000, toleranceSeconds: 10 }),
    ).toBe(false);

    // Malformed or missing headers.
    expect(verifyWebhookRequest(secret, undefined, body, sig, { nowMs })).toBe(false);
    expect(verifyWebhookRequest(secret, ts, body, undefined, { nowMs })).toBe(false);
    expect(verifyWebhookRequest(secret, `${ts}.0`, body, sig, { nowMs })).toBe(false);
    expect(verifyWebhookRequest(secret, "-1", body, sig, { nowMs })).toBe(false);
    // A fresh timestamp does not help an old signature.
    const later = String(nowMs / 1000 + 60);
    expect(verifyWebhookRequest(secret, later, body, sig, { nowMs })).toBe(false);
  });

  it("estimates base64 image size", () => {
    const raw = Buffer.alloc(100, 1).toString("base64");
    expect(estimateImageBytes(raw)).toBe(100);
    expect(estimateImageBytes(`data:image/png;base64,${raw}`)).toBe(100);
    expect(estimateImageBytes("https://example.com/a.png")).toBe(
      Buffer.byteLength("https://example.com/a.png", "utf8"),
    );
  });
});

describe("Standard Webhooks", () => {
  const body = '{"messageId":"m1"}';
  const id = "msg_m1";
  const nowMs = 1_790_000_000_000;
  const ts = String(Math.floor(nowMs / 1000));

  it("matches the reference vector of standardwebhooks.com", () => {
    // From the Standard Webhooks spec test suite (libraries/javascript).
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const sig = signStandardWebhook(secret, "msg_p5jXN8AQM9LWM0D4loKWxJek", "1614265330", '{"test": 2432232314}');
    expect(sig).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("accepts a fresh signature and refuses a stale timestamp, a changed body or a wrong secret", () => {
    const secret = generateStandardWebhookSecret();
    const signature = signStandardWebhook(secret, id, ts, body);
    const headers = { id, timestamp: ts, signature };
    expect(verifyStandardWebhook(secret, headers, body, { nowMs })).toBe(true);
    expect(verifyStandardWebhook(secret, headers, body, { nowMs: nowMs + 299_000 })).toBe(true);
    expect(verifyStandardWebhook(secret, headers, body, { nowMs: nowMs + 301_000 })).toBe(false);
    expect(verifyStandardWebhook(secret, headers, body, { nowMs: nowMs - 301_000 })).toBe(false);
    expect(verifyStandardWebhook(secret, headers, `${body} `, { nowMs })).toBe(false);
    expect(verifyStandardWebhook(generateStandardWebhookSecret(), headers, body, { nowMs })).toBe(false);
    expect(verifyStandardWebhook(secret, { ...headers, id: "msg_other" }, body, { nowMs })).toBe(false);
    expect(verifyStandardWebhook(secret, { ...headers, timestamp: undefined }, body, { nowMs })).toBe(false);
  });

  it("signs with every secret of a rotation, and either one verifies", () => {
    const fresh = generateStandardWebhookSecret();
    const old = generateStandardWebhookSecret();
    const signature = signStandardWebhookAll([fresh, old], id, ts, body);
    expect(signature.split(" ")).toHaveLength(2);
    expect(verifyStandardWebhook(fresh, { id, timestamp: ts, signature }, body, { nowMs })).toBe(true);
    expect(verifyStandardWebhook(old, { id, timestamp: ts, signature }, body, { nowMs })).toBe(true);
  });

  it("keys a secret without whsec_ with its UTF-8 bytes", () => {
    const plain = "a-bot-chosen-secret-123";
    expect(standardWebhookKey(plain).toString("utf8")).toBe(plain);
    const sig = signStandardWebhook(plain, id, ts, body);
    expect(signStandardWebhook(`whsec_${Buffer.from(plain).toString("base64")}`, id, ts, body)).toBe(sig);
  });
});
