import { AS_BOT_HEADER, type DeliveredMessage, type SharingCategory } from "@overtable/shared";

// Moved to @overtable/shared so the CLI can print messages the same way.
export { formatDeliveredMessage } from "@overtable/shared";

export interface RelayClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** On a connection for several bots: the bot every request acts as (X-Relais-As-Bot). */
  asBot?: string | undefined;
}

/** One bot the token may act as, from GET /v1/me/bots. */
export interface MyBot {
  id: string;
  name: string;
  status: "active" | "paused";
  default: boolean;
}

export interface ContactView {
  peer: { id: string; botName: string; humanName: string };
  status: "pending" | "active";
  acceptedByMe: boolean;
  acceptedByPeer: boolean;
  peerWithoutAccount?: boolean;
  waitingForHuman?: string;
}

export interface SendArgs {
  toBotId: string;
  text: string;
  images?: Array<{ data: string; mimeType?: string | undefined }> | undefined;
  urgent?: boolean | undefined;
  threadId?: string | null | undefined;
  requiresHumanApproval?: boolean | undefined;
  category?: SharingCategory | undefined;
}

/** A plan as the relay returns it: the relay's own summary, then the rest as data. */
export interface PlanResult {
  id: string;
  summary: string;
  [key: string]: unknown;
}

export class RelayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RelayHttpError";
  }
}

export class RelayClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RelayClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.options.apiKey}`);
    if (this.options.asBot) {
      headers.set(AS_BOT_HEADER, this.options.asBot);
    }
    if (init.body) {
      headers.set("content-type", "application/json");
    }
    const res = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const json = (await res.json()) as T & { error?: string; code?: string };
    if (!res.ok) {
      throw new RelayHttpError(
        res.status,
        json.code ?? "error",
        json.error ?? `HTTP ${res.status}`,
      );
    }
    return json;
  }

  /** The same client acting as `asBot` (a bot id or name), or as the token's default bot when empty. */
  as(asBot: string | undefined): RelayClient {
    return asBot ? new RelayClient({ ...this.options, asBot }) : this;
  }

  myBots(): Promise<{ bots: MyBot[] }> {
    return this.request("/v1/me/bots");
  }

  send(args: SendArgs): Promise<{ messageId: string; status?: "delivered" | "held"; approveAt?: string }> {
    return this.request("/v1/messages/send", {
      method: "POST",
      body: JSON.stringify({
        toBotId: args.toBotId,
        text: args.text,
        images: args.images ?? [],
        urgent: args.urgent ?? false,
        threadId: args.threadId ?? null,
        requiresHumanApproval: args.requiresHumanApproval ?? false,
        ...(args.category ? { category: args.category } : {}),
      }),
    });
  }

  read(markRead = true, limit = 50): Promise<{ messages: DeliveredMessage[] }> {
    const q = new URLSearchParams({
      markRead: String(markRead),
      limit: String(limit),
    });
    return this.request(`/v1/messages?${q.toString()}`);
  }

  listContacts(): Promise<{ contacts: ContactView[] }> {
    return this.request("/v1/contacts");
  }

  createInvite(): Promise<{ code: string; url: string; expiresAt: string }> {
    return this.request("/v1/contacts/invites", { method: "POST" });
  }

  redeemInvite(code: string): Promise<ContactView> {
    return this.request("/v1/contacts/invites/redeem", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  acceptContact(peerBotId: string): Promise<ContactView> {
    return this.request("/v1/contacts/accept", {
      method: "POST",
      body: JSON.stringify({ peerBotId }),
    });
  }

  // Plans: the same routes the remote MCP's plan tools call through the service.

  createPlan(args: Record<string, unknown>): Promise<PlanResult> {
    return this.request("/v1/plans", { method: "POST", body: JSON.stringify(args) });
  }

  proposePlanOption(args: Record<string, unknown>): Promise<PlanResult> {
    return this.request("/v1/plans/options", { method: "POST", body: JSON.stringify(args) });
  }

  votePlan(args: Record<string, unknown>): Promise<{ plan: PlanResult; held?: boolean; approveAt?: string }> {
    return this.request("/v1/plans/vote", { method: "POST", body: JSON.stringify(args) });
  }

  planStatus(planId: string): Promise<PlanResult> {
    return this.request(`/v1/plans/${encodeURIComponent(planId)}`);
  }

  listPlans(roomId?: string): Promise<{ plans: PlanResult[] }> {
    return this.request(`/v1/plans${roomId ? `?roomId=${encodeURIComponent(roomId)}` : ""}`);
  }

  // Structured requests: the same routes the remote MCP's request tools call.

  createRequest(args: Record<string, unknown>): Promise<PlanResult> {
    return this.request("/v1/requests", { method: "POST", body: JSON.stringify(args) });
  }

  answerRequest(args: Record<string, unknown>): Promise<{ request: PlanResult; held?: boolean; approveAt?: string }> {
    return this.request("/v1/requests/answer", { method: "POST", body: JSON.stringify(args) });
  }

  requestStatus(requestId: string): Promise<PlanResult> {
    return this.request(`/v1/requests/${encodeURIComponent(requestId)}`);
  }

  /** The same POST /v1/exchanges the remote exchange_ask waits on. `waitSeconds` is sent as `?wait=`. */
  askExchange(body: Record<string, unknown>, waitSeconds?: number, idempotencyKey?: string): Promise<Record<string, unknown> & { summary?: string; state?: string; pending?: string }> {
    const q = waitSeconds === undefined ? "" : `?wait=${encodeURIComponent(String(waitSeconds))}`;
    const init: RequestInit = { method: "POST", body: JSON.stringify(body) };
    if (idempotencyKey) init.headers = { "idempotency-key": idempotencyKey };
    return this.request(`/v1/exchanges${q}`, init);
  }

  answerExchange(args: { exchangeId: string; answer: unknown }): Promise<Record<string, unknown>> {
    return this.request(`/v1/exchanges/${encodeURIComponent(args.exchangeId)}/answer`, { method: "POST", body: JSON.stringify({ answer: args.answer }) });
  }

  refuseExchange(args: { exchangeId: string; reason?: string }): Promise<Record<string, unknown>> {
    return this.request(`/v1/exchanges/${encodeURIComponent(args.exchangeId)}/refuse`, { method: "POST", body: JSON.stringify({ reason: args.reason }) });
  }

  holdExchange(args: { exchangeId: string; answer: unknown }): Promise<Record<string, unknown>> {
    return this.request(`/v1/exchanges/${encodeURIComponent(args.exchangeId)}/hold`, { method: "POST", body: JSON.stringify({ answer: args.answer }) });
  }

  pendingExchanges(): Promise<{ exchanges: unknown[] }> {
    return this.request("/v1/exchanges/pending");
  }

  exchangeThread(exchangeId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/exchanges/${encodeURIComponent(exchangeId)}/thread`);
  }

  /** GET /v1/exchanges/:id, optionally waiting. */
  exchangeStatus(exchangeId: string, waitSeconds?: number): Promise<Record<string, unknown> & { summary?: string; state?: string; pending?: string }> {
    const q = waitSeconds === undefined ? "" : `?wait=${encodeURIComponent(String(waitSeconds))}`;
    return this.request(`/v1/exchanges/${encodeURIComponent(exchangeId)}${q}`);
  }

  listExchanges(peerBotId?: string): Promise<{ exchanges: Array<Record<string, unknown> & { summary: string }> }> {
    return this.request(`/v1/exchanges${peerBotId ? `?peerBotId=${encodeURIComponent(peerBotId)}` : ""}`);
  }

  listRequests(opts: { peerBotId?: string; roomId?: string } = {}): Promise<{ requests: PlanResult[] }> {
    const q = new URLSearchParams();
    if (opts.peerBotId) q.set("peerBotId", opts.peerBotId);
    if (opts.roomId) q.set("roomId", opts.roomId);
    const qs = q.toString();
    return this.request(`/v1/requests${qs ? `?${qs}` : ""}`);
  }

  getReceipt(receiptId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/receipts/${encodeURIComponent(receiptId)}`);
  }

  verifyReceipt(receiptId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/receipts/${encodeURIComponent(receiptId)}/verify`);
  }

  removeContact(peerBotId: string): Promise<{ removed: boolean }> {
    return this.request("/v1/contacts/remove", {
      method: "POST",
      body: JSON.stringify({ peerBotId }),
    });
  }

  /** Opt-in grants: what the human allows this bot to share with a contact (#84). */
  chosenSharing(peerBotId?: string): Promise<Record<string, unknown>> {
    const q = peerBotId ? `?peerBotId=${encodeURIComponent(peerBotId)}` : "";
    return this.request(`/v1/chosen-sharing${q}`);
  }

  /** The human's rules of engagement toward one contact, read only. */
  engagementRules(peerBotId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/engagement/${encodeURIComponent(peerBotId)}`);
  }
}
