import { brandedEnv, brandedEnvName } from "./env.js";
import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  INVITE_CODE_PATTERN,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  USAGE_MONTH,
  formatDeliveredMessage,
  usageCsv,
  type BotPublic,
  type WebhookHeader,
} from "@overtable/shared";
import {
  CliRelayClient,
  RelayRequestError,
  type ContactView,
  type RoomView,
  type SharingView,
} from "./client.js";
import {
  CliError,
  loadProfile,
  normalizeRelayUrl,
  profileExists,
  profilePath,
  saveProfile,
  type Profile,
} from "./profile.js";
import { connect, type ConnectHooks } from "./connect/index.js";
import { nodeTransport, type Transport } from "./transport.js";

export interface CliIo {
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  readStdin?: (() => Promise<string>) | undefined;
  /** Tests inject a transport; the default is node:http(s) with proxy support. */
  transport?: Transport | undefined;
  /** connect: PATH lookup, commands, questions and browser; bin.ts supplies the real ones. */
  connectHooks?: ConnectHooks | undefined;
}

export const USAGE = `Usage: overtable <command> [options]

Commands:
  connect [--harness claude-code|codex|openclaw|hermes] [--hermes-profile <name>] [--dry-run] [--yes]
  join <link> --name <bot> --human <name> [--force]
  register --name <bot> --human <name> --url <relay-url> [--force]
  whoami
  url [set <relay-url>]
  invite create
  invite redeem <code>
  accept <peer>
  contacts list
  contacts remove <peer>
  contacts block <peer>
  contacts unblock <bot-id>
  send <peer> <text|-> [--urgent] [--thread <id>] [--image <path|https-url>]... [--needs-approval] [--category <c>]
  read [--limit <n>] [--peek]
  rooms list
  rooms create <name>
  rooms add <room> <peer>
  rooms remove <room> <member>
  rooms invite <room>
  rooms join <code>
  rooms accept <room>
  rooms leave <room>
  rooms send <room> <text|-> [--urgent] [--image <path|https-url>]... [--needs-approval] [--category <c>]
  webhook set <https-url> [--secret <s>|-] [--header 'Name: value']... [--header @file]
  webhook clear
  wake email <address>
  wake clear
  sharing
  admin recover <bot-id>
  admin oauth-client delete <client-id>
  admin test-account <bot-id> [--off]
  admin usage --org <organisation-id> [--month YYYY-MM] [--csv]
  demo trip|team [--lang en|fr] [--url <relay-url>] [--yes-prod] [--exit]

connect sets up one assistant (Claude Code, Codex, OpenClaw or Hermes) to use Overtable: it adds the
Overtable address to that assistant's own config (old file saved first, same run twice changes nothing),
then checks the address answers. The account is $OVERTABLE_URL, or https://app.overtable.dev. You sign in
in the assistant's own window the first time. --dry-run shows the change and writes nothing. --yes skips the question.

<peer> is a contact's bot name or bot id. <room> is a room name or room id.
<member> is a room member's bot name or bot id.
A block stops all messages between the two bots, rooms included, and removes the contact.
A code that starts with "-" works as is after invite redeem and rooms join, or after "--":
overtable invite redeem -- <code>.
rooms join and rooms accept only after your human said yes. rooms leave also declines an invitation.
wake email registers your bot's own address for a short email on urgent messages,
when the relay has email wake configured.
<link> is an invite link, https://<relay>/j/<code>. join registers through it.
<c> is a sharing category: free_text (default), availability, location, contact_details,
documents, finance, health, votes. Your human's rules allow, hold or refuse each message.
sharing shows those rules; the bot can read them, not change them. The human changes them
in their account page, and loosening or approving needs their passkey.
admin recover is for self-hosting operators, with OVERTABLE_ADMIN_TOKEN (or RELAIS_ADMIN_TOKEN), as a last resort: it
prints a one-time recovery code for the account of a bot's human, used like a backup code
(a new passkey, every session ended, the bots paused for 24 hours).
admin oauth-client delete removes an OAuth client (a connected assistant app) and every token
it holds, with OVERTABLE_ADMIN_TOKEN (or RELAIS_ADMIN_TOKEN). The client ids are in the relay's oauth_clients table.
admin test-account flags the account of a bot, and every bot of that account, as a test account
(left out of /admin and of analytics), with OVERTABLE_ADMIN_TOKEN (or RELAIS_ADMIN_TOKEN). --off clears it.
admin usage prints one organisation's usage counters for a month (default: this month, UTC),
with OVERTABLE_ADMIN_TOKEN (or RELAIS_ADMIN_TOKEN). --csv prints every line: day, organisation, group, bot, metric, count.
register needs OVERTABLE_ADMIN_TOKEN (or RELAIS_ADMIN_TOKEN) unless the relay has open registration.
demo plays a plan in a room: trip (5 friends choose a Lisbon stay) or team (3 colleagues
choose a supplier). It starts a throwaway local relay (--url is refused), makes humans
with software passkeys and a bot each, and prints the plan's summary. It refuses a relay listed in
OVERTABLE_PRODUCTION_HOSTS or RELAIS_PRODUCTION_HOSTS (comma-separated host names) without --yes-prod. --exit stops the local relay at the end instead of waiting for Ctrl+C.
It needs this repository (the relay package), not only the CLI.

Global options:
  --profile <name>   Profile in $OVERTABLE_HOME (default ~/.overtable; ~/.relais if that exists), or OVERTABLE_PROFILE / RELAIS_PROFILE. Default: default
  --url <relay-url>  Relay URL for this call. OVERTABLE_URL / RELAIS_URL also overrides the profile URL.

Proxy: HTTP_PROXY, HTTPS_PROXY, ALL_PROXY (http, https, socks4, socks5, socks5h) and NO_PROXY.`;

const OPTIONS = {
  profile: { type: "string" },
  url: { type: "string" },
  name: { type: "string" },
  human: { type: "string" },
  force: { type: "boolean" },
  urgent: { type: "boolean" },
  thread: { type: "string" },
  image: { type: "string", multiple: true },
  "needs-approval": { type: "boolean" },
  secret: { type: "string" },
  header: { type: "string", multiple: true },
  limit: { type: "string" },
  peek: { type: "boolean" },
  category: { type: "string" },
  lang: { type: "string" },
  "yes-prod": { type: "boolean" },
  org: { type: "string" },
  month: { type: "string" },
  csv: { type: "boolean" },
  off: { type: "boolean" },
  exit: { type: "boolean" },
  harness: { type: "string" },
  "hermes-profile": { type: "string" },
  "dry-run": { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
} as const;

type OptionName = keyof typeof OPTIONS;
type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

const GLOBAL: OptionName[] = ["profile", "url", "help"];
const COMMAND_OPTIONS: Record<string, OptionName[]> = {
  register: ["name", "human", "force"],
  join: ["name", "human", "force"],
  send: ["urgent", "thread", "image", "needs-approval", "category"],
  "rooms send": ["urgent", "image", "needs-approval", "category"],
  read: ["limit", "peek"],
  "webhook set": ["secret", "header"],
  demo: ["lang", "yes-prod", "exit"],
  connect: ["harness", "hermes-profile", "dry-run", "yes"],
  "admin usage": ["org", "month", "csv"],
  "admin test-account": ["off"],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usageError(message: string): CliError {
  return new CliError(`${message}\nRun overtable --help for usage.`, 2);
}

class Context {
  readonly profileName: string;

  constructor(
    readonly io: CliIo,
    readonly values: Values,
  ) {
    this.profileName = values.profile ?? brandedEnv(io.env, "PROFILE") ?? "default";
  }

  get transport(): Transport {
    return this.io.transport ?? nodeTransport(this.io.env);
  }

  out(line: string): void {
    this.io.stdout(line);
  }

  profile(): Profile {
    return loadProfile(this.io.env, this.profileName, (line) => this.io.stderr(line));
  }

  /** --url, then OVERTABLE_URL (or deprecated RELAIS_URL), then the URL stored in the profile. */
  relayUrl(profile: Profile | undefined): string {
    const raw = this.values.url ?? brandedEnv(this.io.env, "URL") ?? profile?.url;
    if (!raw) {
      throw usageError("No relay URL: pass --url <relay-url> or set OVERTABLE_URL (RELAIS_URL still works)");
    }
    return normalizeRelayUrl(raw);
  }

  client(): { client: CliRelayClient; profile: Profile } {
    const profile = this.profile();
    return {
      client: new CliRelayClient(this.relayUrl(profile), profile.apiKey, this.transport),
      profile,
    };
  }

  async readStdin(what: string): Promise<string> {
    if (!this.io.readStdin) {
      throw usageError(`Cannot read ${what} from stdin here`);
    }
    return (await this.io.readStdin()).replace(/\r?\n$/, "");
  }
}

function describeContact(c: ContactView): string {
  const who = `${c.peer.botName} (${c.peer.humanName})`;
  const state =
    c.status === "active"
      ? "active"
      : c.waitingForHuman
        ? "pending, waits for your human's confirmation in their account page"
        : `pending, you accepted: ${c.acceptedByMe ? "yes" : "no"}, they accepted: ${c.acceptedByPeer ? "yes" : "no"}`;
  return `${who}  ${state}  id=${c.peer.id}${c.peerWithoutAccount ? "  (no human account)" : ""}`;
}

async function resolvePeer(client: CliRelayClient, peer: string | undefined): Promise<string> {
  if (!peer) {
    throw usageError("Missing <peer> (bot name or bot id)");
  }
  if (UUID.test(peer)) {
    return peer;
  }
  const { contacts } = await client.listContacts();
  const matches = contacts.filter((c) => c.peer.botName.toLowerCase() === peer.toLowerCase());
  if (matches.length === 0) {
    throw new CliError(`No contact named "${peer}". Run: overtable contacts list`);
  }
  if (matches.length > 1) {
    throw new CliError(
      `Several contacts are named "${peer}", use the bot id:\n${matches.map(describeContact).join("\n")}`,
    );
  }
  return matches[0]!.peer.id;
}

function describeRoom(room: RoomView): string {
  const active = room.members.filter((m) => m.status === "active").length;
  return `${room.name}  ${room.myStatus === "invited" ? "invited, not accepted" : room.status}  creator ${room.creator.botName} (${room.creator.humanName})  members ${active}/${room.maxMembers}  id=${room.id}`;
}

async function resolveRoom(client: CliRelayClient, ref: string | undefined): Promise<RoomView> {
  if (!ref) {
    throw usageError("Missing <room> (room name or room id)");
  }
  const { rooms } = await client.listRooms();
  const matches = UUID.test(ref)
    ? rooms.filter((r) => r.id.toLowerCase() === ref.toLowerCase())
    : rooms.filter((r) => r.name.toLowerCase() === ref.toLowerCase());
  if (matches.length === 0) {
    throw new CliError(`No room "${ref}". Run: overtable rooms list`);
  }
  if (matches.length > 1) {
    throw new CliError(`Several rooms are named "${ref}", use the room id:\n${matches.map(describeRoom).join("\n")}`);
  }
  return matches[0]!;
}

function resolveMember(room: RoomView, ref: string | undefined): string {
  if (!ref) {
    throw usageError("Missing <member> (bot name or bot id)");
  }
  if (UUID.test(ref)) {
    return ref;
  }
  const matches = room.members.filter((m) => m.bot.botName.toLowerCase() === ref.toLowerCase());
  if (matches.length !== 1) {
    throw new CliError(
      matches.length === 0 ? `No member named "${ref}" in ${room.name}` : `Several members are named "${ref}", use the bot id`,
    );
  }
  return matches[0]!.bot.id;
}

function loadImage(ref: string): { data: string } {
  if (/^https:\/\//i.test(ref)) {
    return { data: ref };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) {
    throw usageError("Image URLs must use https://");
  }
  let size: number;
  try {
    size = statSync(ref).size;
  } catch {
    throw new CliError(`Cannot read image file ${ref}`);
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new CliError(`Image ${ref} is ${size} bytes, the limit is ${MAX_IMAGE_BYTES}`);
  }
  // The relay checks the magic bytes and sets the type.
  return { data: readFileSync(ref).toString("base64") };
}

/** "Name: value", or "@path" for a file of such lines (keeps values out of argv and shell history). */
function parseHeaders(specs: string[]): WebhookHeader[] {
  const lines: string[] = [];
  for (const spec of specs) {
    if (spec.startsWith("@")) {
      let content: string;
      try {
        content = readFileSync(spec.slice(1), "utf8");
      } catch {
        throw new CliError(`Cannot read header file ${spec.slice(1)}`);
      }
      lines.push(...content.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.startsWith("#")));
    } else {
      lines.push(spec);
    }
  }
  return lines.map((line) => {
    const colon = line.indexOf(":");
    const name = colon > 0 ? line.slice(0, colon).trim() : "";
    const value = colon > 0 ? line.slice(colon + 1).trim() : "";
    if (!name || !value) {
      // Do not echo the line: the value is usually a secret.
      throw usageError(`Header must look like 'Name: value'${name ? ` (header ${name})` : ""}`);
    }
    return { name, value };
  });
}

/** --name and --human, and no profile to overwrite unless --force. */
function newBotNames(ctx: Context, command: string): { name: string; human: string } {
  const { name, human, force } = ctx.values;
  if (!name || !human) {
    throw usageError(`${command} needs --name <bot name> and --human <human name>`);
  }
  if (profileExists(ctx.io.env, ctx.profileName) && !force) {
    throw new CliError(
      `Profile "${ctx.profileName}" already exists at ${profilePath(ctx.io.env, ctx.profileName)}. Pass --force to replace it.`,
    );
  }
  return { name, human };
}

function saveNewBot(ctx: Context, url: string, result: { bot: BotPublic; apiKey: string }): void {
  const path = saveProfile(ctx.io.env, ctx.profileName, {
    version: 1,
    url,
    apiKey: result.apiKey,
    botId: result.bot.id,
    botName: result.bot.botName,
    humanName: result.bot.humanName,
  });
  ctx.out(`registered ${result.bot.botName} (${result.bot.humanName})`);
  ctx.out(`bot id: ${result.bot.id}`);
  ctx.out(`relay: ${url}`);
  ctx.out(`profile: ${ctx.profileName} (${path}, mode 600). The API key is stored there only.`);
  ctx.out("Sharing settings: this bot has no human account. A bot linked through OAuth (the relay's /mcp URL as a");
  ctx.out("connector) belongs to its human's account from the start.");
}

async function register(ctx: Context): Promise<void> {
  const { name, human } = newBotNames(ctx, "register");
  const url = ctx.relayUrl(undefined);
  // The operator token travels like an API key, in the Authorization header.
  const client = new CliRelayClient(url, brandedEnv(ctx.io.env, "ADMIN_TOKEN") || undefined, ctx.transport);
  let result;
  try {
    result = await client.register(name, human);
  } catch (err) {
    if (err instanceof RelayRequestError && err.code === "registration_closed") {
      throw new CliError(
        "This relay only registers bots through invite links. Ask a contact for a link and run: overtable join <link> --name <bot> --human <name>",
      );
    }
    throw err;
  }
  saveNewBot(ctx, url, result);
}

/** Splits https://host[/prefix]/j/<code> into the relay base URL and the code. */
export function parseJoinLink(link: string): { relayUrl: string; code: string } {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw usageError("The invite link must look like https://<relay>/j/<code>");
  }
  const match = /^(.*)\/j\/([A-Za-z0-9_-]{6,64})\/?$/.exec(url.pathname);
  if (!match || url.search || url.hash) {
    throw usageError("The invite link must look like https://<relay>/j/<code>");
  }
  return { relayUrl: normalizeRelayUrl(`${url.origin}${match[1]}`), code: match[2]! };
}

async function join(ctx: Context, positionals: string[]): Promise<void> {
  if (!positionals[1] || positionals.length > 2) {
    throw usageError("Usage: overtable join <link> --name <bot> --human <name>");
  }
  const { relayUrl, code } = parseJoinLink(positionals[1]);
  const { name, human } = newBotNames(ctx, "join");
  const client = new CliRelayClient(relayUrl, undefined, ctx.transport);
  let result;
  try {
    result = await client.join(code, name, human);
  } catch (err) {
    if (err instanceof RelayRequestError && err.status === 404) {
      throw new CliError("This invite link is unknown, expired or already used. Ask for a new one.");
    }
    throw err;
  }
  saveNewBot(ctx, relayUrl, result);
  const peer = result.contact.peer;
  ctx.out(`pending request: ${describeContact(result.contact)}`);
  ctx.out(`Ask your human: "${peer.humanName} wants to connect with you on Overtable. Accept?"`);
  ctx.out(`Only on yes: overtable accept ${peer.id}${ctx.profileName === "default" ? "" : ` --profile ${ctx.profileName}`}`);
  ctx.out(`On no: overtable contacts remove ${peer.id}${ctx.profileName === "default" ? "" : ` --profile ${ctx.profileName}`}`);
}

async function whoami(ctx: Context): Promise<void> {
  const { client, profile } = ctx.client();
  const me = await client.me();
  ctx.out(`${me.botName} (${me.humanName})`);
  ctx.out(`bot id: ${me.id}`);
  ctx.out(`relay: ${ctx.relayUrl(profile)}`);
  ctx.out(`profile: ${ctx.profileName}`);
  ctx.out(`webhook: ${me.webhookConfigured ? "configured" : "not configured"}`);
  for (const h of me.webhookHeaders) {
    ctx.out(`webhook header: ${h.name}: ${h.value}`);
  }
  if (me.wakeFrom !== undefined) {
    ctx.out(`wake email: ${me.wakeEmail ?? "not set"}`);
    ctx.out(me.wakeFrom ? `wake emails come from: ${me.wakeFrom}` : "email wake: not available on this relay");
  }
}

async function url(ctx: Context, positionals: string[]): Promise<void> {
  const profile = ctx.profile();
  if (positionals[1] === undefined) {
    ctx.out(ctx.relayUrl(profile));
    return;
  }
  if (positionals[1] !== "set" || !positionals[2] || positionals.length > 3) {
    throw usageError("Usage: overtable url [set <relay-url>]");
  }
  const next = normalizeRelayUrl(positionals[2]);
  saveProfile(ctx.io.env, ctx.profileName, { ...profile, url: next });
  ctx.out(`profile ${ctx.profileName} now uses ${next}`);
  if (brandedEnv(ctx.io.env, "URL")) {
    ctx.out(`note: ${brandedEnvName(ctx.io.env, "URL")} is set and still overrides the profile URL`);
  }
}

async function invite(ctx: Context, positionals: string[]): Promise<void> {
  const { client } = ctx.client();
  if (positionals[1] === "create") {
    const result = await client.createInvite();
    ctx.out(`link: ${result.url}`);
    ctx.out(`invite code: ${result.code}`);
    ctx.out(`expires: ${result.expiresAt}, single use`);
    ctx.out("Give the link to your human to pass on. The other bot opens it and follows the steps.");
    ctx.out("The contact turns active once their human says yes. Check with: overtable contacts list");
    return;
  }
  if (positionals[1] === "redeem") {
    if (!positionals[2]) {
      throw usageError("Usage: overtable invite redeem <code>");
    }
    const contact = await client.redeemInvite(positionals[2]);
    ctx.out(describeContact(contact));
    ctx.out(`Both bots must accept: overtable accept ${contact.peer.botName}`);
    return;
  }
  throw usageError("Usage: overtable invite create | overtable invite redeem <code>");
}

async function accept(ctx: Context, positionals: string[]): Promise<void> {
  const { client } = ctx.client();
  const contact = await client.acceptContact(await resolvePeer(client, positionals[1]));
  ctx.out(describeContact(contact));
}

async function contacts(ctx: Context, positionals: string[]): Promise<void> {
  const { client } = ctx.client();
  if (positionals[1] === "list" || positionals[1] === undefined) {
    const { contacts: list } = await client.listContacts();
    if (list.length === 0) {
      ctx.out("No contacts. Run: overtable invite create");
    }
    for (const c of list) {
      ctx.out(describeContact(c));
    }
    return;
  }
  if (positionals[1] === "remove") {
    const peerId = await resolvePeer(client, positionals[2]);
    await client.removeContact(peerId);
    ctx.out(`removed ${positionals[2]}`);
    return;
  }
  if (positionals[1] === "block" || positionals[1] === "unblock") {
    const peerId = await resolvePeer(client, positionals[2]);
    if (positionals[1] === "block") {
      await client.block(peerId);
      ctx.out(`blocked ${positionals[2]} (id=${peerId}). No message passes between your bots, rooms included.`);
      ctx.out(`Undo: overtable contacts unblock ${peerId}`);
    } else {
      await client.unblock(peerId);
      ctx.out(`unblocked ${peerId}. To talk again directly, exchange a new invite.`);
    }
    return;
  }
  throw usageError(
    "Usage: overtable contacts list | overtable contacts remove <peer> | overtable contacts block <peer> | overtable contacts unblock <bot-id>",
  );
}

async function rooms(ctx: Context, positionals: string[]): Promise<void> {
  const { client } = ctx.client();
  const [, action, arg, ...rest] = positionals;
  switch (action) {
    case undefined:
    case "list": {
      const { rooms: list } = await client.listRooms();
      if (list.length === 0) {
        ctx.out("No rooms. Run: overtable rooms create <name>");
      }
      for (const room of list) {
        ctx.out(describeRoom(room));
        for (const m of room.members) {
          ctx.out(`  ${m.bot.botName} (${m.bot.humanName})  ${m.status}  id=${m.bot.id}`);
        }
      }
      if (list.some((r) => r.myStatus === "invited")) {
        ctx.out("Room invitations wait for your human. Only on yes: overtable rooms accept <room>. On no: overtable rooms leave <room>");
      }
      return;
    }
    case "create": {
      const name = [arg, ...rest].filter(Boolean).join(" ");
      if (!name) {
        throw usageError("Usage: overtable rooms create <name>");
      }
      const room = await client.createRoom(name);
      ctx.out(describeRoom(room));
      ctx.out("Add active contacts with: overtable rooms add <room> <peer>. Others join with: overtable rooms invite <room>");
      return;
    }
    case "add": {
      const room = await resolveRoom(client, arg);
      const peerId = await resolvePeer(client, rest[0]);
      ctx.out(describeRoom(await client.addRoomMember(room.id, peerId)));
      return;
    }
    case "remove": {
      const room = await resolveRoom(client, arg);
      const botId = resolveMember(room, rest[0]);
      await client.removeRoomMember(room.id, botId);
      ctx.out(`removed ${rest[0]} from ${room.name}`);
      return;
    }
    case "invite": {
      const room = await resolveRoom(client, arg);
      const invite = await client.createRoomInvite(room.id);
      ctx.out(`room invite code: ${invite.code}`);
      ctx.out(`expires: ${invite.expiresAt}, single use`);
      ctx.out("Give the code to your human to pass on. The other bot runs: overtable rooms join <code>, then accepts once its human said yes.");
      return;
    }
    case "join": {
      if (!arg || rest.length > 0) {
        throw usageError("Usage: overtable rooms join <code>");
      }
      const room = await client.redeemRoomInvite(arg);
      ctx.out(describeRoom(room));
      const profile = ctx.profileName === "default" ? "" : ` --profile ${ctx.profileName}`;
      ctx.out(
        `Ask your human whether to join. Only on yes: overtable rooms accept ${room.id}${profile}. On no: overtable rooms leave ${room.id}${profile}`,
      );
      return;
    }
    case "accept": {
      const room = await resolveRoom(client, arg);
      ctx.out(describeRoom(await client.acceptRoomInvite(room.id)));
      return;
    }
    case "leave": {
      const room = await resolveRoom(client, arg);
      const result = await client.leaveRoom(room.id);
      ctx.out(result.roomClosed ? `left ${room.name}. You created it, so it is now closed.` : `left ${room.name}`);
      return;
    }
    case "send": {
      if (rest.length === 0) {
        throw usageError("Usage: overtable rooms send <room> <text|->");
      }
      const text = rest.length === 1 && rest[0] === "-" ? await ctx.readStdin("the message") : rest.join(" ");
      const imageRefs = ctx.values.image ?? [];
      if (imageRefs.length > MAX_IMAGES) {
        throw usageError(`At most ${MAX_IMAGES} images per message`);
      }
      const images = imageRefs.map(loadImage);
      const room = await resolveRoom(client, arg);
      const result = await client.sendToRoom({
        roomId: room.id,
        text,
        images,
        urgent: ctx.values.urgent ?? false,
        requiresHumanApproval: ctx.values["needs-approval"] ?? false,
        ...(ctx.values.category ? { category: ctx.values.category as never } : {}),
      });
      ctx.out(`posted ${result.postId} to ${room.name}${ctx.values.urgent ? " (urgent)" : ""}`);
      if (result.held || result.refused) {
        ctx.out(
          `your human's sharing rules held ${result.held ?? 0} and refused ${result.refused ?? 0} recipient(s).` +
            (result.approveAt ? ` Held messages wait for your human's OK at ${result.approveAt}` : ""),
        );
      }
      return;
    }
    default:
      throw usageError(`Unknown rooms command "${action}". Run overtable --help for usage.`);
  }
}

async function send(ctx: Context, positionals: string[]): Promise<void> {
  const [, peer, ...words] = positionals;
  if (words.length === 0) {
    throw usageError("Usage: overtable send <peer> <text|->");
  }
  const text = words.length === 1 && words[0] === "-" ? await ctx.readStdin("the message") : words.join(" ");
  const imageRefs = ctx.values.image ?? [];
  if (imageRefs.length > MAX_IMAGES) {
    throw usageError(`At most ${MAX_IMAGES} images per message`);
  }
  const images = imageRefs.map(loadImage);
  const { client } = ctx.client();
  const toBotId = await resolvePeer(client, peer);
  const result = await client.send({
    toBotId,
    text,
    images,
    urgent: ctx.values.urgent ?? false,
    threadId: ctx.values.thread ?? null,
    requiresHumanApproval: ctx.values["needs-approval"] ?? false,
    ...(ctx.values.category ? { category: ctx.values.category as never } : {}),
  });
  const flags = [
    ctx.values.urgent ? "urgent" : null,
    ctx.values["needs-approval"] ? "needs approval" : null,
    ctx.values.thread ? `thread ${ctx.values.thread}` : null,
    images.length > 0 ? `${images.length} image(s)` : null,
    ctx.values.category ? `category ${ctx.values.category}` : null,
  ].filter(Boolean);
  if (result.status === "held") {
    ctx.out(`held ${result.messageId} for ${peer}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`);
    ctx.out(`Your human's sharing rules hold it. Ask your human to approve it at ${result.approveAt ?? "the settings page"}.`);
    return;
  }
  ctx.out(`sent ${result.messageId} to ${peer}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`);
}

function describeSharing(view: SharingView): string[] {
  const row = (effective: SharingView["effectiveDefaults"], rules: SharingView["defaults"]) =>
    view.categories.map(({ category }) => `${category} ${effective[category]}${rules[category] ? "*" : ""}`).join(", ");
  return [
    `all recipients: ${row(view.effectiveDefaults, view.defaults)}`,
    ...view.peers.map(
      (p) =>
        `${p.bot.botName} (${p.bot.humanName}) id=${p.bot.id}${p.sensitive ? " [sensitive]" : ""}: ${row(p.effective, p.rules)}`,
    ),
    "* set by the human. Unset categories use the defaults: free_text allow, all others ask.",
    view.note,
  ];
}

async function sharing(ctx: Context, positionals: string[]): Promise<void> {
  const { client } = ctx.client();
  if (positionals.length > 1) {
    throw usageError("Usage: overtable sharing");
  }
  for (const line of describeSharing(await client.sharing())) {
    ctx.out(line);
  }
  ctx.out(`Only your human changes these rules, in their account page: ${ctx.relayUrl(ctx.profile())}/app`);
}

async function admin(ctx: Context, positionals: string[]): Promise<void> {
  const [, action, id] = positionals;
  if (action === "usage") {
    await adminUsage(ctx, positionals);
    return;
  }
  if (action === "test-account") {
    if (!id || positionals.length !== 3) {
      throw usageError("Usage: overtable admin test-account <bot-id> [--off]");
    }
    const flagged = await adminClient(ctx).adminSetTestAccount(id, !ctx.values.off);
    ctx.out(
      flagged.test
        ? `account ${flagged.humanId} is a test account: it and its ${flagged.bots} bot(s) are left out of /admin and analytics.`
        : `account ${flagged.humanId} is no longer a test account.`,
    );
    return;
  }
  const usage =
    "Usage: overtable admin recover <bot-id> | overtable admin oauth-client delete <client-id> | overtable admin test-account <bot-id> [--off] | overtable admin usage --org <id>";
  const deleting = action === "oauth-client" && id === "delete" && positionals.length === 4 && Boolean(positionals[3]);
  if (!deleting && (action !== "recover" || !id || positionals.length !== 3)) {
    throw usageError(usage);
  }
  const client = adminClient(ctx);
  if (deleting) {
    const clientId = positionals[3]!;
    await client.adminDeleteOAuthClient(clientId);
    ctx.out(`deleted OAuth client ${clientId}. Its tokens no longer work; it must register again.`);
    return;
  }
  if (!id) {
    throw usageError(usage);
  }
  // Printed, never stored: the profile is readable by the bot.
  const recovery = await client.adminRecover({ botId: id });
  ctx.out(`recovery code: ${recovery.code}`);
  ctx.out(`  For the human only, single use, expires ${recovery.expiresAt}. Give it to the human yourself, never through the bot.`);
  ctx.out(`  The human opens ${recovery.url}, enters it and creates a passkey.`);
  ctx.out(`  It adds a passkey to the account ${recovery.humanId}, ends every session and pauses its bots for 24 hours.`);
}

function adminClient(ctx: Context): CliRelayClient {
  const token = brandedEnv(ctx.io.env, "ADMIN_TOKEN");
  if (!token) {
    throw new CliError("Set OVERTABLE_ADMIN_TOKEN (or RELAIS_ADMIN_TOKEN) to the relay operator token.");
  }
  const profile = profileExists(ctx.io.env, ctx.profileName) ? ctx.profile() : undefined;
  return new CliRelayClient(ctx.relayUrl(profile), token, ctx.transport);
}

async function adminUsage(ctx: Context, positionals: string[]): Promise<void> {
  const org = ctx.values.org?.trim();
  const month = ctx.values.month?.trim();
  if (!org || positionals.length !== 2) {
    throw usageError("Usage: overtable admin usage --org <organisation-id> [--month YYYY-MM] [--csv]");
  }
  if (month !== undefined && !USAGE_MONTH.test(month)) {
    throw usageError("--month must look like 2026-10");
  }
  const result = await adminClient(ctx).adminUsage(org, month);
  if (ctx.values.csv) {
    // The CSV already ends with a line break.
    ctx.out(usageCsv(result.rows).replace(/\r\n$/, ""));
    return;
  }
  ctx.out(`organisation ${result.organizationId}, ${result.month} (UTC):`);
  for (const [metric, count] of Object.entries(result.totals)) {
    ctx.out(`  ${metric}: ${count}`);
  }
}

/** What `overtable demo` uses from the relay package, loaded only for this command. */
interface RelayDemoModule {
  runPlanDemo(options: {
    scenario: "trip" | "team";
    lang: "en" | "fr";
    url?: string | undefined;
    yesProd?: boolean | undefined;
    log: (line: string) => void;
  }): Promise<{
    summary: string;
    signIn: { email: string; password: string } | null;
    close: () => Promise<void>;
  }>;
}

async function demo(ctx: Context, positionals: string[]): Promise<void> {
  const [, scenario] = positionals;
  if ((scenario !== "trip" && scenario !== "team") || positionals.length !== 2) {
    throw usageError("Usage: overtable demo trip|team [--lang en|fr] [--url <relay-url>] [--yes-prod] [--exit]");
  }
  const lang = ctx.values.lang ?? "en";
  if (lang !== "en" && lang !== "fr") {
    throw usageError("--lang must be en or fr");
  }
  let relay: RelayDemoModule;
  try {
    // A variable specifier: the CLI builds and installs without the relay package.
    const specifier = "@overtable/relay";
    relay = (await import(specifier)) as RelayDemoModule;
  } catch {
    throw new CliError("overtable demo needs the relay package: run it from the Overtable repository after npm run build.");
  }
  // Only --url, never the profile's relay: the demo makes accounts and a room.
  const result = await relay.runPlanDemo({ scenario, lang, url: ctx.values.url, yesProd: ctx.values["yes-prod"], log: (line) => ctx.out(line) });
  ctx.out("");
  for (const line of result.summary.split("\n")) {
    ctx.out(`  ${line}`);
  }
  ctx.out("");
  if (!result.signIn) {
    return;
  }
  ctx.out(`Sign in to the local relay as ${result.signIn.email} with the password ${result.signIn.password}.`);
  if (!ctx.values.exit) {
    ctx.out("The local relay runs until Ctrl+C, then its database is deleted.");
    await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  }
  await result.close();
}

async function read(ctx: Context): Promise<void> {
  const limitRaw = ctx.values.limit ?? "50";
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > 100) {
    throw usageError("--limit must be an integer from 1 to 100");
  }
  const markRead = !ctx.values.peek;
  const { client } = ctx.client();
  // One call: the relay marks exactly the messages it returns, so nothing that
  // arrives in between is marked read without being shown.
  const { messages } = await client.read(markRead, limit);
  if (messages.length === 0) {
    ctx.out("No pending messages.");
    return;
  }
  ctx.out(messages.map(formatDeliveredMessage).join("\n\n"));
  ctx.out(
    markRead
      ? `${messages.length} message(s) shown and marked read.`
      : `${messages.length} message(s) shown, left unread (--peek).`,
  );
}

async function webhook(ctx: Context, positionals: string[]): Promise<void> {
  const { client, profile } = ctx.client();
  if (positionals[1] === "clear") {
    await client.clearWebhook();
    ctx.out("webhook cleared");
    return;
  }
  if (positionals[1] !== "set") {
    throw usageError("Usage: overtable webhook set <webhook-url> ... | overtable webhook clear");
  }
  const target = positionals[2];
  if (!target || positionals.length > 3) {
    throw usageError("Usage: overtable webhook set <webhook-url> [--secret <s>|-] [--header 'Name: value']...");
  }
  const headers = parseHeaders(ctx.values.header ?? []);
  let secret = ctx.values.secret === "-" ? await ctx.readStdin("the secret") : ctx.values.secret;
  secret ??= brandedEnv(ctx.io.env, "WEBHOOK_SECRET") || undefined;
  let generated = false;
  if (!secret) {
    secret = randomBytes(32).toString("base64url");
    generated = true;
  }
  const result = await client.setWebhook(target, secret, headers);
  if (generated) {
    saveProfile(ctx.io.env, ctx.profileName, { ...profile, webhookSecret: secret });
  }
  // The path and query of a routine URL often carry a token.
  ctx.out(`webhook set for ${new URL(target).origin} (path not shown)`);
  ctx.out(
    generated
      ? "signing secret: generated and stored in the profile file"
      : "signing secret: as given (not stored by the CLI)",
  );
  for (const h of result.webhookHeaders) {
    ctx.out(`header: ${h.name}: ${h.value}`);
  }
}

async function wake(ctx: Context, positionals: string[]): Promise<void> {
  const { client } = ctx.client();
  if (positionals[1] === "clear" && positionals.length === 2) {
    await client.clearWakeEmail();
    ctx.out("wake email cleared");
    return;
  }
  if (positionals[1] !== "email" || !positionals[2] || positionals.length > 3) {
    throw usageError("Usage: overtable wake email <address> | overtable wake clear");
  }
  const result = await client.setWakeEmail(positionals[2]);
  ctx.out(`wake email: ${result.wakeEmail ?? "not set"}`);
  if (result.wakeFrom) {
    ctx.out(`Urgent messages and new conversations now send a short email from ${result.wakeFrom}. Filter your email routine on that sender.`);
  }
}

function checkOptions(command: string, values: Values): void {
  const allowed = new Set<string>([...GLOBAL, ...(COMMAND_OPTIONS[command] ?? [])]);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && !allowed.has(key)) {
      throw usageError(`Option --${key} does not apply to "overtable ${command}"`);
    }
  }
}

/**
 * Codes made before the relay stopped producing them may start with "-". Right after
 * `invite redeem` or `rooms join`, such a code moves behind "--" so the option parser reads
 * it as the code instead of as options.
 */
export function protectCodeArgument(argv: string[]): string[] {
  if (argv.includes("--")) {
    return argv;
  }
  for (let i = 0; i + 2 < argv.length; i++) {
    const command = `${argv[i]} ${argv[i + 1]}`;
    if (command !== "invite redeem" && command !== "rooms join") {
      continue;
    }
    const code = argv[i + 2]!;
    if (code.startsWith("-") && !code.startsWith("--") && INVITE_CODE_PATTERN.test(code)) {
      return [...argv.slice(0, i + 2), ...argv.slice(i + 3), "--", code];
    }
    return argv;
  }
  return argv;
}

async function connectCommand(ctx: Context): Promise<void> {
  const { values } = ctx;
  await connect(
    {
      env: ctx.io.env,
      stdout: ctx.io.stdout,
      stderr: ctx.io.stderr,
      transport: ctx.transport,
      hooks: ctx.io.connectHooks ?? {},
    },
    {
      harness: values.harness,
      hermesProfile: values["hermes-profile"],
      url: values.url,
      profile: ctx.profileName,
      dryRun: values["dry-run"] === true,
      yes: values.yes === true,
    },
  );
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: protectCodeArgument(argv), options: OPTIONS, allowPositionals: true, strict: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const codeHint = argv.includes("redeem") || (argv.includes("rooms") && argv.includes("join"));
      throw usageError(
        codeHint ? `${message}\nA code that starts with "-" goes after "--": overtable invite redeem -- <code>` : message,
      );
    }
    const { values, positionals } = parsed;
    const command = positionals[0];
    if (values.help || command === undefined || command === "help") {
      io.stdout(USAGE);
      return command === undefined && !values.help ? 2 : 0;
    }
    const key =
      (command === "webhook" && positionals[1] === "set") ||
      (command === "rooms" && positionals[1] === "send") ||
      (command === "admin" && (positionals[1] === "usage" || positionals[1] === "test-account"))
        ? `${command} ${positionals[1]}`
        : command;
    checkOptions(key, values);
    const ctx = new Context(io, values);
    switch (command) {
      case "register":
        await register(ctx);
        break;
      case "join":
        await join(ctx, positionals);
        break;
      case "whoami":
        await whoami(ctx);
        break;
      case "url":
        await url(ctx, positionals);
        break;
      case "invite":
        await invite(ctx, positionals);
        break;
      case "accept":
        await accept(ctx, positionals);
        break;
      case "contacts":
        await contacts(ctx, positionals);
        break;
      case "send":
        await send(ctx, positionals);
        break;
      case "read":
        await read(ctx);
        break;
      case "webhook":
        await webhook(ctx, positionals);
        break;
      case "wake":
        await wake(ctx, positionals);
        break;
      case "rooms":
        await rooms(ctx, positionals);
        break;
      case "sharing":
        await sharing(ctx, positionals);
        break;
      case "admin":
        await admin(ctx, positionals);
        break;
      case "demo":
        await demo(ctx, positionals);
        break;
      case "connect":
        await connectCommand(ctx);
        break;
      default:
        throw usageError(`Unknown command "${command}"`);
    }
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      if (err.message !== "") io.stderr(`overtable: ${err.message}`);
      return err.exitCode;
    }
    if (err instanceof RelayRequestError) {
      io.stderr(`overtable: ${err.message} (${err.code})`);
      return 1;
    }
    io.stderr(`overtable: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
