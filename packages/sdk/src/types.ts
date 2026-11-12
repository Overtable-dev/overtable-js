/**
 * The partner API's shapes as the relay sends them (docs/partners.md). Pair names, states and typed
 * answers come from @overtable/shared, the relay's own types; the rest mirrors
 * packages/relay/src/partners/service.ts, which the conformance check runs against.
 */
import type {
  ContactChannelAnswer,
  ExchangePair,
  ExchangeState,
  FreeBusyAnswer,
  OffersListAnswer,
  QuoteAnswer,
  RateRangeAnswer,
  ScopeAskAnswer,
} from "@overtable/shared";

export type { ExchangePair, ExchangeState, FreeBusyAnswer, OffersListAnswer, QuoteAnswer, RateRangeAnswer, ScopeAskAnswer, ContactChannelAnswer };

/** What a partner may ask a user for. Overtable never grants a scope that widens a mandate or commits the user. */
export type PartnerScope = "door:manage" | "exchanges:read" | "exchanges:answer" | "mandate:read" | "mandate:tighten";

export const PARTNER_SCOPES: readonly PartnerScope[] = ["door:manage", "exchanges:read", "exchanges:answer", "mandate:read", "mandate:tighten"];

/** The trades a door can start from: each one is a mandate preset. `property_owner` is read as `host`. */
export type Trade = "freelance" | "consultant" | "coach" | "artisan" | "host" | "property_owner" | "creator";

/** A user's tokens after the consent or a refresh. */
export interface PartnerTokens {
  accessToken: string;
  /** Rotates on each refresh: store the new one, the old one ends every token of the link if reused. */
  refreshToken: string;
  /** Seconds, as the relay said (3600). */
  expiresIn: number;
  /** When the access token ends, by this process's clock. */
  expiresAt: Date;
  scopes: PartnerScope[];
  /** One link per partner and user; a new consent keeps it. */
  linkId: string;
}

/** The token endpoint's answer, on the wire. */
export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
  link_id: string;
}

export interface PartnerBranding {
  partner: string;
  /** "via Collabnod" */
  label: string;
  logoUrl: string | null;
  color: string | null;
  backUrl: string;
}

export interface DoorView {
  botName: string;
  /** Null until the door has a public name (the one proposed at consent, or one the user picks in /app). */
  handle: string | null;
  url: string | null;
  trade: string | null;
  backUrl: string | null;
  branding: PartnerBranding | null;
}

/** What setting a trade did to the user's mandate. */
export type MandateOutcome =
  | { status: "applied"; changes: string[] }
  | { status: "needs_confirmation"; loosens: string[]; confirmUrl: string; expiresAt: string }
  | { status: string };

export interface DoorUpdate {
  trade?: Trade;
  /** https on the partner's domain or a subdomain. */
  backUrl?: string | null;
  botName?: string;
}

export interface DoorUpdateResult extends DoorView {
  mandate?: MandateOutcome;
}

export interface Me {
  linkId: string;
  scopes: PartnerScope[];
  /** The user's display name; never an e-mail. */
  user: { name: string };
  door: DoorView;
}

export interface Withheld {
  /** "answer", "answer.reply", "params.text"... */
  part: string;
  /** free_text, not_released, not_answered, unknown_pair */
  reason: string;
}

/** One exchange of the user's door, typed, without free text the human has not released. */
export interface PartnerExchange {
  id: string;
  pair: ExchangePair | (string & {});
  state: ExchangeState | (string & {});
  /** incoming: someone asked the door. outgoing: the door asked. */
  direction: "incoming" | "outgoing";
  peer: { name: string; humanName: string; handle: string | null; kind: string; level: string };
  params: Record<string, unknown> | null;
  answer: Record<string, unknown> | null;
  withheld: Withheld[];
  decision: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface AnswerResult {
  exchange: PartnerExchange;
  /** True when the user's rules hold the answer for them: it reaches the asker once they release it. */
  held: boolean;
  heldByRecipient?: string;
}

/** The fixed reasons a refusal can give. The asker reads Overtable's words, never the partner's. */
export type RefuseReason = "not_available" | "not_offered" | "declined";

export interface MandateView {
  source: "mandate";
  /** False: the user has no mandate yet and their rules as they stand decide. */
  stored: boolean;
  mandate: {
    trade: string | null;
    pairs: Record<string, Record<string, "allow" | "ask" | "deny">>;
    bounds: Record<string, unknown>;
    neverShare: string[];
  };
  updatedAt: string | null;
}

export interface TightenResult extends MandateView {
  result: MandateOutcome;
}

/** How the partner vouches for its own user who asks a door. Never above an e-mail it confirmed. */
export interface Fan {
  /** The partner's opaque id of its user: 1 to 64 letters, digits, `.`, `:`, `-` or `_`. Never an e-mail. */
  ref: string;
  level: "anonymous" | "email_verified";
}

export interface FanQuestion {
  pair: ExchangePair | (string & {});
  params: Record<string, unknown>;
  fan: Fan;
  /** A quote acceptance names the quote it accepts. */
  inReplyTo?: string;
}

/** An exchange at a door, as the door shows it to whoever asked. */
export interface DoorExchange {
  id: string;
  pair: ExchangePair | (string & {});
  state: ExchangeState | (string & {});
  params: Record<string, unknown>;
  answer: Record<string, unknown> | null;
  summary: string;
  heldForOwner: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  inReplyTo: string | null;
  /** Set once a commitment (a confirmed meeting, an accepted quote) has its signed receipt. */
  receipt: { id: string; verifyToken: string } | null;
  asker?: { kind: "partner"; level: string; ref: string };
}

/** GET /v1/partners/account: the partner's record, without secrets, client id or redirect URIs. */
export interface PartnerAccount {
  id: string;
  slug: string;
  name: string;
  domain: string;
  /** What this partner may ask a user for. */
  scopes: PartnerScope[];
  webhookUrl: string | null;
  color: string | null;
  hasLogo: boolean;
  requestsPerMinute: number;
  createdAt: string;
}

export interface PartnerLink {
  linkId: string;
  scopes: PartnerScope[];
  createdAt: string;
  door: { handle: string | null; trade: string | null };
}

export interface WebhookDelivery {
  /** The webhook-id header of the delivery. */
  id: string;
  linkId: string | null;
  event: string;
  status: "pending" | "retrying" | "delivered" | "failed";
  attempts: number;
  nextAttemptAt: string | null;
  lastHttpStatus: number | null;
  lastReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRow {
  id: string;
  linkId: string;
  action: string;
  status: number;
  createdAt: string;
}

/** POST /v1/partners/decisions/:id: the tap of the partner's user, as the partner reports it. */
export interface DecisionReport {
  verdict: "approve" | "refuse";
  /** The partner's own reference of who tapped. Never an e-mail. */
  actor: string;
  /** When the user tapped, by the partner's clock (ISO 8601). */
  decidedAt: string;
}

export interface DecisionResult {
  exchangeId: string;
  verdict: "approved" | "refused";
  decidedVia: "partner";
  decidedAt: string | null;
}

/** GET /v1/receipts/:token/verify: the public check. Never parties, names or amounts. */
export interface PublicReceiptCheck {
  valid: boolean;
  id?: string;
  kind?: string;
  createdAt?: string;
  contentHash?: string;
  /** not_found, revoked, tampered, bad_signature, bad_format... */
  code?: string;
  rule?: { state: "unchanged" | "changed" | "removed" };
}
