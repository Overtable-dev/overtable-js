import type { BotPublic, DeliveredMessage, SharingCategory, SharingDecision, UsageCsvRow, WebhookHeader } from "@overtable/shared";
import type { Transport } from "./transport.js";

export interface ContactView {
  peer: BotPublic;
  status: "pending" | "active";
  acceptedByMe: boolean;
  acceptedByPeer: boolean;
  peerWithoutAccount?: boolean;
  waitingForHuman?: string;
}

export interface MeView extends BotPublic {
  webhookConfigured: boolean;
  webhookHeaders: WebhookHeader[];
  /** Missing on relays older than email wake. */
  wakeEmail?: string | null;
  wakeFrom?: string | null;
}

export interface WakeEmailView {
  wakeEmail: string | null;
  wakeFrom: string | null;
}

/** Operator only: one organisation's month of usage counters. */
export interface AdminUsage {
  organizationId: string;
  month: string;
  totals: Record<string, number>;
  rows: UsageCsvRow[];
}

/** Operator only: shown once. */
export interface RecoveryCode {
  code: string;
  url: string;
  expiresAt: string;
  humanId: string;
}

export interface JoinResult {
  bot: BotPublic;
  apiKey: string;
  contact: ContactView;
}

export interface SharingView {
  categories: Array<{ category: SharingCategory; description: string; builtin: SharingDecision }>;
  defaults: Partial<Record<SharingCategory, SharingDecision>>;
  effectiveDefaults: Record<SharingCategory, SharingDecision>;
  peers: Array<{
    bot: BotPublic;
    sensitive: boolean;
    rules: Partial<Record<SharingCategory, SharingDecision>>;
    effective: Record<SharingCategory, SharingDecision>;
  }>;
  settingsUrl: string;
  note: string;
}

export interface SendResult {
  messageId: string;
  /** Missing on relays older than sharing rules. */
  status?: "delivered" | "held";
  approveAt?: string;
}

export interface RoomView {
  id: string;
  name: string;
  status: "open" | "closed";
  creator: BotPublic;
  myStatus: "invited" | "active" | "left" | "removed";
  maxMembers: number;
  members: Array<{ bot: BotPublic; status: "invited" | "active" }>;
}

export interface RoomSendBody {
  roomId: string;
  text: string;
  images: Array<{ data: string }>;
  urgent: boolean;
  requiresHumanApproval: boolean;
  category?: SharingCategory;
}

export interface SendBody {
  toBotId: string;
  text: string;
  images: Array<{ data: string }>;
  urgent: boolean;
  threadId: string | null;
  requiresHumanApproval: boolean;
  category?: SharingCategory;
}

export class RelayRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RelayRequestError";
  }
}

/** Relay HTTP API over an injectable transport (proxy aware by default). */
export class CliRelayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly transport: Transport,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    let res;
    try {
      res = await this.transport({
        method,
        url: `${this.baseUrl}${path}`,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new RelayRequestError(0, "unreachable", `Cannot reach relay at ${this.baseUrl}: ${reason}`);
    }
    let json: (T & { error?: string; code?: string }) | undefined;
    try {
      json = JSON.parse(res.body) as T & { error?: string; code?: string };
    } catch {
      json = undefined;
    }
    if (res.status < 200 || res.status >= 300 || json === undefined) {
      throw new RelayRequestError(
        res.status,
        json?.code ?? "error",
        json?.error ?? `Relay answered HTTP ${res.status} without a JSON body`,
      );
    }
    return json;
  }

  register(botName: string, humanName: string): Promise<{ bot: BotPublic; apiKey: string }> {
    return this.request("POST", "/v1/bots/register", { botName, humanName });
  }

  join(code: string, botName: string, humanName: string): Promise<JoinResult> {
    return this.request("POST", "/v1/join", { code, botName, humanName });
  }

  me(): Promise<MeView> {
    return this.request("GET", "/v1/me");
  }

  setWebhook(
    url: string,
    secret: string,
    headers: WebhookHeader[],
  ): Promise<{ webhookConfigured: boolean; webhookHeaders: WebhookHeader[] }> {
    return this.request("PUT", "/v1/me/webhook", { url, secret, headers });
  }

  clearWebhook(): Promise<{ webhookConfigured: boolean }> {
    return this.request("PUT", "/v1/me/webhook", { clear: true });
  }

  setWakeEmail(address: string): Promise<WakeEmailView> {
    return this.request("PUT", "/v1/me/wake-email", { address });
  }

  clearWakeEmail(): Promise<WakeEmailView> {
    return this.request("PUT", "/v1/me/wake-email", { clear: true });
  }

  createInvite(): Promise<{ code: string; url: string; expiresAt: string }> {
    return this.request("POST", "/v1/contacts/invites");
  }

  redeemInvite(code: string): Promise<ContactView> {
    return this.request("POST", "/v1/contacts/invites/redeem", { code });
  }

  acceptContact(peerBotId: string): Promise<ContactView> {
    return this.request("POST", "/v1/contacts/accept", { peerBotId });
  }

  removeContact(peerBotId: string): Promise<{ removed: boolean }> {
    return this.request("POST", "/v1/contacts/remove", { peerBotId });
  }

  listContacts(): Promise<{ contacts: ContactView[] }> {
    return this.request("GET", "/v1/contacts");
  }

  block(peerBotId: string): Promise<{ blocked: boolean }> {
    return this.request("POST", "/v1/contacts/block", { peerBotId });
  }

  unblock(peerBotId: string): Promise<{ unblocked: boolean }> {
    return this.request("POST", "/v1/contacts/unblock", { peerBotId });
  }

  listRooms(): Promise<{ rooms: RoomView[] }> {
    return this.request("GET", "/v1/rooms");
  }

  createRoom(name: string): Promise<RoomView> {
    return this.request("POST", "/v1/rooms", { name });
  }

  addRoomMember(roomId: string, botId: string): Promise<RoomView> {
    return this.request("POST", "/v1/rooms/members/add", { roomId, botId });
  }

  removeRoomMember(roomId: string, botId: string): Promise<{ removed: boolean }> {
    return this.request("POST", "/v1/rooms/members/remove", { roomId, botId });
  }

  createRoomInvite(roomId: string): Promise<{ code: string; roomId: string; expiresAt: string }> {
    return this.request("POST", "/v1/rooms/invites", { roomId });
  }

  redeemRoomInvite(code: string): Promise<RoomView> {
    return this.request("POST", "/v1/rooms/invites/redeem", { code });
  }

  acceptRoomInvite(roomId: string): Promise<RoomView> {
    return this.request("POST", "/v1/rooms/accept", { roomId });
  }

  leaveRoom(roomId: string): Promise<{ left: boolean; roomClosed: boolean }> {
    return this.request("POST", "/v1/rooms/leave", { roomId });
  }

  sendToRoom(body: RoomSendBody): Promise<{ postId: string; held?: number; refused?: number; approveAt?: string }> {
    return this.request("POST", "/v1/rooms/send", body);
  }

  send(body: SendBody): Promise<SendResult> {
    return this.request("POST", "/v1/messages/send", body);
  }

  read(markRead: boolean, limit: number): Promise<{ messages: DeliveredMessage[] }> {
    return this.request("GET", `/v1/messages?markRead=${markRead}&limit=${limit}`);
  }

  /** Read only, with the bot key. */
  sharing(): Promise<SharingView> {
    return this.request("GET", "/v1/sharing");
  }

  adminRecover(target: { botId: string } | { humanId: string }): Promise<RecoveryCode> {
    return this.request("POST", "/v1/admin/recover", target);
  }

  adminSetTestAccount(botId: string, test: boolean): Promise<{ humanId: string; test: boolean; bots: number }> {
    return this.request("POST", "/v1/admin/test-account", { botId, test });
  }

  adminDeleteOAuthClient(clientId: string): Promise<{ deleted: true }> {
    return this.request("POST", "/v1/admin/oauth-clients/delete", { clientId });
  }
  /** Operator only, read only: one organisation's counters for a month (YYYY-MM, the current one when omitted). */
  adminUsage(organizationId: string, month?: string): Promise<AdminUsage> {
    const query = new URLSearchParams({ org: organizationId, ...(month ? { month } : {}) });
    return this.request("GET", `/v1/admin/usage?${query.toString()}`);
  }

}
