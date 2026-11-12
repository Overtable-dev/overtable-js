import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

/**
 * Overtable's signed receipts (docs/protocol/receipts.md), checked offline: no network, no
 * database. The same steps, in the same order and with the same failure codes, as the relay's
 * verifier (packages/relay/src/receipts/verify.ts, used by `overtable-receipt-verify` and by the
 * public check behind /verify): the format, receiptHash against the canonical payload, the Ed25519
 * signature, then the subject's shape. The tests of @overtable/verify run both on the same receipts.
 *
 * Online, `GET /v1/receipts/<verify token>/verify` gives the relay's own verdict and also knows
 * whether a receipt was revoked, which an offline check cannot.
 */

export const RECEIPT_FORMAT = "overtable-receipt-v1";
export const RECEIPT_SIGNING_ALG = "Ed25519";
/** The owner-confirmation authority whose method names the proof Overtable checked. */
export const AGREEMENT_AUTHORITY_VERSION = 2;

const DECISION_METHODS = new Set(["passkey", "email_code", "trusted_device", "session", "approval_link", "partner"]);
const OWNER_METHODS = new Set([...DECISION_METHODS, "agent_reported"]);
const DECISIONS = new Set(["approved", "rejected"]);
const ACTION_TYPES = new Set(["send_to_bot", "send_to_room", "request_answer", "commitment", "plan_vote", "engagement_rule", "engagement_hold", "offer_grid", "held_request"]);

export interface ReceiptSignature {
  alg: string;
  kid: string;
  /** SPKI DER, base64url. */
  publicKey: string;
  /** 64 raw bytes, base64url. */
  signature: string;
}

export interface SignedReceipt {
  payload: {
    format: typeof RECEIPT_FORMAT;
    id: string;
    subject: { kind: string; contentHash?: string; [key: string]: unknown };
    parties?: unknown[];
    authority?: Record<string, unknown>;
    decisions?: Array<{ id: string; receiptHash: string }>;
    createdAt: string;
    prevReceiptHash?: string | null;
    [key: string]: unknown;
  };
  receiptHash: string;
  signature: ReceiptSignature;
}

/** A key the relay publishes at /.well-known/audit-signing.json. */
export interface RelayPublicKey {
  kid: string;
  alg: string;
  /** SPKI DER, base64url. */
  publicKey: string;
}

export type ReceiptFailure = "bad_format" | "bad_hash" | "bad_signature" | "bad_key" | "bad_alg" | "bad_payload";

export interface ReceiptCheck {
  ok: boolean;
  code?: ReceiptFailure;
  message?: string;
}

export interface VerifyReceiptOptions {
  /**
   * The relay's keys. Without them the check uses the key the receipt embeds: it proves the
   * receipt was not altered, not that Overtable signed it. Pass the keys of
   * /.well-known/audit-signing.json (OvertablePartner.relayKeys()) to prove both.
   */
  trustedKeys?: readonly RelayPublicKey[];
}

/** Stable JSON: object keys sorted, undefined dropped. RFC 8785 for the values a receipt carries. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hex SHA-256 of the canonical payload: what receiptHash must be. */
export function receiptHashOf(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const isDigest = (value: unknown): boolean => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

/** A signed receipt, or null when the object is not overtable-receipt-v1. */
export function parseReceipt(raw: unknown): SignedReceipt | null {
  if (!isRecord(raw) || !isRecord(raw.payload) || !isRecord(raw.signature)) return null;
  if (raw.payload.format !== RECEIPT_FORMAT || typeof raw.payload.id !== "string") return null;
  if (typeof raw.receiptHash !== "string") return null;
  return raw as unknown as SignedReceipt;
}

/** What is wrong with a signed payload's shape, or null when it is a receipt this draft defines. */
export function receiptPayloadProblem(payload: Record<string, unknown>): string | null {
  const subject = payload.subject;
  if (!isRecord(subject) || typeof subject.kind !== "string") return "subject missing";
  if (payload.decisions !== undefined) {
    if (subject.kind === "decision") return "a decision receipt cites no decisions";
    if (!Array.isArray(payload.decisions) || !payload.decisions.every((d) => isRecord(d) && typeof d.id === "string" && typeof d.receiptHash === "string")) {
      return "decisions must list {id, receiptHash}";
    }
  }
  const authority = payload.authority;
  if (isRecord(authority) && authority.version !== undefined) {
    if (authority.version !== AGREEMENT_AUTHORITY_VERSION) return `unknown authority version ${String(authority.version)}`;
    if (!OWNER_METHODS.has(String(authority.method))) return "unknown owner confirmation method";
  }
  switch (subject.kind) {
    case "request_accept":
    case "plan_agreed":
      return typeof subject.contentHash === "string" ? null : "contentHash missing";
    case "decision":
      if (!DECISIONS.has(String(subject.decision))) return "decision must be approved or rejected";
      if (!DECISION_METHODS.has(String(subject.method))) return "unknown decision method";
      if (!ACTION_TYPES.has(String(subject.actionType))) return "unknown action type";
      if (!isDigest(subject.contentHash)) return "contentHash must be a SHA-256 hex digest";
      if (typeof subject.itemId !== "string" || typeof subject.decidedAt !== "string") return "itemId and decidedAt are required";
      if (subject.presentedAt !== null && typeof subject.presentedAt !== "string") return "presentedAt must be a timestamp or null";
      if (subject.lines !== undefined && (!Array.isArray(subject.lines) || !subject.lines.every((l) => isRecord(l) && typeof l.id === "string" && isDigest(l.hash)))) {
        return "lines must list {id, hash}";
      }
      return null;
    default:
      return `unknown subject kind ${subject.kind}`;
  }
}

function loadPublic(spki: string): KeyObject {
  const key = createPublicKey({ key: Buffer.from(spki, "base64url"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("not Ed25519");
  return key;
}

function checkSignature(payload: unknown, signed: ReceiptSignature, trustedKeys: readonly RelayPublicKey[] | undefined): ReceiptCheck {
  if (signed.alg !== RECEIPT_SIGNING_ALG) return { ok: false, code: "bad_alg", message: `Unsupported alg ${signed.alg}.` };
  if (typeof signed.kid !== "string" || typeof signed.publicKey !== "string" || typeof signed.signature !== "string") {
    return { ok: false, code: "bad_payload", message: "Signature is missing required fields." };
  }
  let spki = signed.publicKey;
  if (trustedKeys && trustedKeys.length > 0) {
    const match =
      trustedKeys.find((k) => k.kid === signed.kid && k.publicKey === signed.publicKey) ??
      trustedKeys.find((k) => k.kid === signed.kid) ??
      trustedKeys.find((k) => k.publicKey === signed.publicKey);
    if (!match) return { ok: false, code: "bad_key", message: `Signature kid ${signed.kid} is not among the trusted public keys.` };
    spki = match.publicKey;
  }
  let key: KeyObject;
  try {
    key = loadPublic(spki);
  } catch {
    return { ok: false, code: "bad_key", message: "Signature publicKey is not a valid Ed25519 SPKI key." };
  }
  const bytes = Buffer.from(signed.signature, "base64url");
  if (bytes.length !== 64) return { ok: false, code: "bad_signature", message: "Signature has the wrong length." };
  if (!verify(null, Buffer.from(canonicalJson(payload), "utf8"), key, bytes)) {
    return { ok: false, code: "bad_signature", message: "Signature does not match the payload." };
  }
  return { ok: true };
}

/** Offline check of one signed receipt (an object, or its JSON text). */
export function verifyReceipt(raw: unknown, options: VerifyReceiptOptions = {}): ReceiptCheck {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, code: "bad_format", message: "Receipt is not valid JSON." };
    }
  }
  const signed = parseReceipt(value);
  if (!signed) return { ok: false, code: "bad_format", message: "Not an overtable-receipt-v1 object." };
  if (receiptHashOf(signed.payload) !== signed.receiptHash) {
    return { ok: false, code: "bad_hash", message: "receiptHash does not match the payload." };
  }
  const signature = checkSignature(signed.payload, signed.signature, options.trustedKeys);
  if (!signature.ok) return signature;
  const problem = receiptPayloadProblem(signed.payload as Record<string, unknown>);
  if (problem) return { ok: false, code: "bad_payload", message: problem };
  return { ok: true };
}

/** The long verify token of a receipt: `OT-XXXX-` and thirteen Crockford characters. A short id alone is not enough. */
export const VERIFY_TOKEN = /^OT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{13}$/;
