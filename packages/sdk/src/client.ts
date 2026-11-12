import { createHash, randomBytes } from "node:crypto";
import { verifyReceipt, VERIFY_TOKEN, type ReceiptCheck, type RelayPublicKey } from "@overtable/verify";
import type {
  AnswerResult,
  AuditRow,
  DecisionReport,
  DecisionResult,
  DoorExchange,
  DoorUpdate,
  DoorUpdateResult,
  DoorView,
  FanQuestion,
  MandateView,
  Me,
  PartnerAccount,
  PartnerExchange,
  PartnerLink,
  PartnerScope,
  PartnerTokens,
  PublicReceiptCheck,
  RefuseReason,
  TightenResult,
  TokenResponse,
  WebhookDelivery,
} from "./types.js";

/**
 * A client of Overtable's partner API. It carries calls; it decides nothing.
 * The user's rules, their confirmations and the receipts stay on the relay: an answer the user's
 * mandate holds waits for them whatever the SDK sends, and no call here widens a mandate or
 * commits the user.
 *
 * Two kinds of credentials, never mixed, as on the relay:
 * - the partner's own: the API key (`otpk_...`), and the OAuth client (`otpc_...` / `otps_...`);
 * - one user's tokens (`otpa_...` / `otpr_...`), from that user's consent, for what the partner
 *   does for them (`partner.user(tokens)`).
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PartnerConfig {
  /** The relay, e.g. https://app.overtable.dev. */
  baseUrl: string;
  /** otpc_... */
  clientId?: string;
  /** otps_... Server side only. */
  clientSecret?: string;
  /** otpk_... Server side only. */
  apiKey?: string;
  /** Tests, or a runtime without a global fetch. */
  fetch?: FetchLike;
}

/** An answer of the relay that is not a 2xx: its status, its code (`insufficient_scope`, `not_found`...) and its reason. */
export class OvertableApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly reason: string | null,
    readonly body: unknown,
    /** Seconds, on a 429. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "OvertableApiError";
  }
}

/** What the consent redirect brought back when the user (or Overtable) said no. */
export class ConsentError extends Error {
  constructor(
    /** invalid_scope, access_denied... */
    readonly error: string,
    readonly description: string | null,
  ) {
    super(description ? `${error}: ${description}` : error);
    this.name = "ConsentError";
  }
}

export interface AuthorizeOptions {
  /** One of the redirect URIs the operator registered for the partner. */
  redirectUri: string;
  /** No scope given: `door:manage exchanges:read`, as the relay does. */
  scopes?: readonly PartnerScope[];
  /** The door name the partner proposes. The user sees it and confirms it with the link. */
  handle?: string;
  /** Opaque, checked on the way back. Made for you when left out. */
  state?: string;
}

export interface AuthorizeRequest {
  /** Send the user here. */
  url: string;
  /** Keep both with the user's session until the callback. */
  state: string;
  codeVerifier: string;
}

export interface CallbackResult {
  code: string;
  state: string;
  /** The relay that issued the code (RFC 9207). */
  iss: string | null;
}

/** A user's tokens and where to keep them when they rotate. */
export interface UserSession {
  tokens: PartnerTokens;
  /** Called with the new tokens after each refresh: store them, the refresh token rotates. */
  onRefresh?: (tokens: PartnerTokens) => void | Promise<void>;
}

const b64url = (bytes: Buffer) => bytes.toString("base64url");

export class OvertablePartner {
  readonly baseUrl: string;
  private readonly doFetch: FetchLike;

  constructor(private readonly config: PartnerConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.doFetch = config.fetch ?? ((input, init) => fetch(input, init));
  }

  // The user's consent: OAuth 2.0 authorization code with PKCE (S256).

  /** Where to send a user to link their Overtable account. Keep `state` and `codeVerifier` for the callback. */
  authorize(options: AuthorizeOptions): AuthorizeRequest {
    const codeVerifier = b64url(randomBytes(32));
    const state = options.state ?? b64url(randomBytes(16));
    const query = new URLSearchParams({
      response_type: "code",
      client_id: this.need("clientId"),
      redirect_uri: options.redirectUri,
      scope: (options.scopes ?? ["door:manage", "exchanges:read"]).join(" "),
      state,
      code_challenge: b64url(createHash("sha256").update(codeVerifier).digest()),
      code_challenge_method: "S256",
      ...(options.handle ? { handle: options.handle } : {}),
    });
    return { url: `${this.baseUrl}/oauth/partner/authorize?${query.toString()}`, state, codeVerifier };
  }

  /**
   * Reads the callback URL: the code when the user consented, a ConsentError when Overtable sent
   * an error back (a scope the partner was not granted, for one), an Error when the state differs.
   */
  parseCallback(callbackUrl: string | URL, expectedState: string): CallbackResult {
    const url = new URL(callbackUrl);
    const state = url.searchParams.get("state");
    if (state !== expectedState) throw new Error("The state of the callback is not the one this consent started with.");
    const error = url.searchParams.get("error");
    if (error) throw new ConsentError(error, url.searchParams.get("error_description"));
    const code = url.searchParams.get("code");
    if (!code) throw new ConsentError("invalid_request", "The callback carries no code.");
    return { code, state, iss: url.searchParams.get("iss") };
  }

  /** Exchanges the code for the user's tokens, within 2 minutes of the consent. A code works once. */
  async exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }): Promise<PartnerTokens> {
    return this.token({ grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri, code_verifier: input.codeVerifier });
  }

  /** A new access token. The refresh token rotates: reusing an old one ends every token of the link. */
  async refresh(refreshToken: string): Promise<PartnerTokens> {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async token(fields: Record<string, string>): Promise<PartnerTokens> {
    const res = await this.doFetch(`${this.baseUrl}/oauth/partner/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ ...fields, client_id: this.need("clientId"), client_secret: this.need("clientSecret") }).toString(),
    });
    const body = (await readJson(res)) as Partial<TokenResponse> & { error?: string; error_description?: string };
    if (!res.ok) {
      throw new OvertableApiError(res.status, body.error ?? null, `token: ${body.error ?? res.status}${body.error_description ? ` ${body.error_description}` : ""}`, null, body);
    }
    return toTokens(body as TokenResponse);
  }

  /** The calls made for one user, with their tokens. With `onRefresh`, the access token is renewed a minute before it ends. */
  user(session: UserSession | PartnerTokens | string): PartnerUser {
    const s: UserSession =
      typeof session === "string"
        ? { tokens: { accessToken: session, refreshToken: "", expiresIn: 0, expiresAt: new Date(8.64e15), scopes: [], linkId: "" } }
        : "tokens" in session
          ? session
          : { tokens: session };
    return new PartnerUser(this, s);
  }

  // The partner's own, with the API key.

  /** The partner's record, without secrets. */
  account(): Promise<PartnerAccount> {
    return this.call("GET", "/v1/partners/account", this.need("apiKey"));
  }

  /** Its linked users: link id, scopes, date, the door's handle and trade. No name, no e-mail. */
  async links(limit = 100): Promise<PartnerLink[]> {
    return (await this.call<{ links: PartnerLink[] }>("GET", `/v1/partners/links?limit=${limit}`, this.need("apiKey"))).links;
  }

  /** Recent webhook deliveries with their status, attempts and last HTTP status. */
  async deliveries(limit = 50): Promise<WebhookDelivery[]> {
    return (await this.call<{ deliveries: WebhookDelivery[] }>("GET", `/v1/partners/webhooks?limit=${limit}`, this.need("apiKey"))).deliveries;
  }

  /** Sends a failed delivery again. */
  async replayDelivery(id: string): Promise<void> {
    await this.call("POST", `/v1/partners/webhooks/${encodeURIComponent(id)}/replay`, this.need("apiKey"));
  }

  /** Changes the webhook URL; returns a new secret, once, when asked or when there was none. */
  setWebhook(input: { url: string | null; rotateSecret?: boolean }): Promise<{ url: string | null; secret?: string }> {
    return this.call("PUT", "/v1/partners/webhook", this.need("apiKey"), input);
  }

  /** One row per call made for a user: the route and the status, never a body. */
  async audit(options: { linkId?: string; limit?: number } = {}): Promise<AuditRow[]> {
    const q = new URLSearchParams({ limit: String(options.limit ?? 100), ...(options.linkId ? { linkId: options.linkId } : {}) });
    return (await this.call<{ audit: AuditRow[] }>("GET", `/v1/partners/audit?${q.toString()}`, this.need("apiKey"))).audit;
  }

  /** What a door answers and at which level (public). */
  async doorPairs(handle: string): Promise<Array<{ pair: string; needs: "anonymous" | "email_verified"; askable: boolean }>> {
    return (await this.call<{ pairs: Array<{ pair: string; needs: "anonymous" | "email_verified"; askable: boolean }> }>("GET", `/v1/doors/${doorPath(handle)}`)).pairs;
  }

  /**
   * Relays one of the partner's own users' questions to a door its owner linked to this partner,
   * server to server. The partner vouches for what it checked of that user, never above an
   * e-mail it confirmed; the door's rules decide at that level.
   */
  async askDoor(handle: string, question: FanQuestion): Promise<DoorExchange> {
    return (await this.call<{ exchange: DoorExchange }>("POST", `/v1/doors/${doorPath(handle)}/exchanges`, this.need("apiKey"), question)).exchange;
  }

  /** That user's exchanges at that door, as the door shows them: the typed answer once it reached them, the receipt of a commitment. */
  async fanExchanges(handle: string, fanRef: string): Promise<DoorExchange[]> {
    return (await this.call<{ exchanges: DoorExchange[] }>("GET", `/v1/doors/${doorPath(handle)}/exchanges?fan=${encodeURIComponent(fanRef)}`, this.need("apiKey"))).exchanges;
  }

  /**
   * Reports the tap of a user who decides in the partner's app. Only for a decision Overtable
   * sent here (`decision_requested`): the user must first have put `partner` in that pair's
   * approveVia, which they confirm on Overtable.
   */
  reportDecision(exchangeId: string, report: DecisionReport): Promise<DecisionResult> {
    return this.call("POST", `/v1/partners/decisions/${encodeURIComponent(exchangeId)}`, this.need("apiKey"), report);
  }

  // Receipts, public.

  /** The relay's verdict on a receipt by its long verify token: the same check as /verify/<token>. */
  async checkReceipt(verifyToken: string): Promise<PublicReceiptCheck> {
    if (!VERIFY_TOKEN.test(verifyToken)) {
      throw new Error("A receipt is checked by its long verify token (OT-XXXX-XXXXXXXXXXXXX); the short id alone is not enough.");
    }
    const res = await this.doFetch(`${this.baseUrl}/v1/receipts/${encodeURIComponent(verifyToken)}/verify`, { headers: { accept: "application/json" } });
    const body = await readJson(res);
    // A receipt that does not verify is an answer, not an error; a rate limit is an error.
    if (res.status === 429 || res.status >= 500) throw apiError(res, body);
    return body as PublicReceiptCheck;
  }

  /** The public keys that sign receipts, from /.well-known/audit-signing.json. Cache them. */
  async relayKeys(): Promise<RelayPublicKey[]> {
    return (await this.call<{ keys: RelayPublicKey[] }>("GET", "/.well-known/audit-signing.json")).keys;
  }

  /** Offline check of a signed receipt against this relay's published keys: proves it is unaltered and signed by Overtable. */
  async verifyReceipt(signed: unknown): Promise<ReceiptCheck> {
    return verifyReceipt(signed, { trustedKeys: await this.relayKeys() });
  }

  /** @internal */
  async call<T>(method: string, path: string, bearer?: string, body?: unknown): Promise<T> {
    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await readJson(res);
    if (!res.ok) throw apiError(res, json);
    return json as T;
  }

  private need(key: "clientId" | "clientSecret" | "apiKey"): string {
    const value = this.config[key];
    if (!value) throw new Error(`OvertablePartner: set ${key} for this call.`);
    return value;
  }
}

/** The calls made for one linked user, within the scopes they consented to. Each leaves one audit row. */
export class PartnerUser {
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly partner: OvertablePartner,
    private readonly session: UserSession,
  ) {}

  get tokens(): PartnerTokens {
    return this.session.tokens;
  }

  /** The link id, the scopes, the user's display name (never an e-mail) and the door. */
  me(): Promise<Me> {
    return this.call("GET", "/v1/partners/me");
  }

  /** `door:manage`. */
  door(): Promise<DoorView> {
    return this.call("GET", "/v1/partners/me/door");
  }

  /**
   * `door:manage`. A trade starts the mandate from its preset: applied at once when it only
   * tightens, else a proposal the user confirms on Overtable (`mandate.confirmUrl`).
   */
  setDoor(update: DoorUpdate): Promise<DoorUpdateResult> {
    return this.call("PUT", "/v1/partners/me/door", update);
  }

  /** `exchanges:read`: newest first, typed, without free text the user has not released. */
  async exchanges(limit = 50): Promise<PartnerExchange[]> {
    return (await this.call<{ exchanges: PartnerExchange[] }>("GET", `/v1/partners/me/exchanges?limit=${limit}`)).exchanges;
  }

  /** `exchanges:read`. */
  exchange(id: string): Promise<PartnerExchange> {
    return this.call("GET", `/v1/partners/me/exchanges/${encodeURIComponent(id)}`);
  }

  /**
   * `exchanges:answer`: answers as the user's door, when the partner hosts their agent. The answer
   * is validated against the pair's schema, as any bot's; `held: true` means the user's rules hold
   * it for them (the human decides, on Overtable).
   */
  answer(id: string, answer: Record<string, unknown>): Promise<AnswerResult> {
    return this.call("POST", `/v1/partners/me/exchanges/${encodeURIComponent(id)}/answer`, { answer });
  }

  /** `exchanges:answer`: refuses with a fixed reason; the asker reads Overtable's words. */
  refuse(id: string, reason: RefuseReason): Promise<PartnerExchange> {
    return this.call("POST", `/v1/partners/me/exchanges/${encodeURIComponent(id)}/refuse`, { reason });
  }

  /** `mandate:read`. */
  mandate(): Promise<MandateView> {
    return this.call("GET", "/v1/partners/me/mandate");
  }

  /** `mandate:tighten`: applies when every line is stricter; a widening line answers 403 and changes nothing. */
  tighten(patch: Record<string, unknown>): Promise<TightenResult> {
    return this.call("POST", "/v1/partners/me/mandate/tighten", { patch });
  }

  /** Ends the link: every token stops, the door stays the user's. */
  async unlink(): Promise<void> {
    await this.call("DELETE", "/v1/partners/me");
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.freshen();
    return this.partner.call<T>(method, path, this.session.tokens.accessToken, body);
  }

  private async freshen(): Promise<void> {
    const { tokens, onRefresh } = this.session;
    if (!onRefresh || !tokens.refreshToken || tokens.expiresAt.getTime() - Date.now() > 60_000) return;
    this.refreshing ??= (async () => {
      try {
        const next = await this.partner.refresh(tokens.refreshToken);
        this.session.tokens = next;
        await onRefresh(next);
      } finally {
        this.refreshing = null;
      }
    })();
    await this.refreshing;
  }
}

function toTokens(body: TokenResponse): PartnerTokens {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
    scopes: body.scope.split(" ").filter(Boolean) as PartnerScope[],
    linkId: body.link_id,
  };
}

function doorPath(handle: string): string {
  return encodeURIComponent(handle.replace(/^@/, ""));
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text.slice(0, 200) };
  }
}

function apiError(res: Response, body: unknown): OvertableApiError {
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; code?: unknown; reason?: unknown };
  const retry = Number(res.headers.get("retry-after"));
  return new OvertableApiError(
    res.status,
    typeof b.code === "string" ? b.code : null,
    `${res.status}${typeof b.code === "string" ? ` ${b.code}` : ""}${typeof b.error === "string" ? `: ${b.error}` : ""}`,
    typeof b.reason === "string" ? b.reason : null,
    body,
    Number.isFinite(retry) && retry > 0 ? retry : null,
  );
}
