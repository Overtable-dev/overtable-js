import { INFO_HEADER, TRUST_NOTE } from "./constants.js";
import { estimateImageBytes } from "./crypto.js";
import type { DeliveredMessage, DeliveryEnvelope, MessageImage } from "./types.js";

/**
 * Characters a reader does not see but a model does: zero-width spaces and joiners, direction
 * marks, embeddings, overrides and isolates, the word joiner and invisible operators, the byte
 * order mark, the soft hyphen, interlinear annotations, and the Unicode tag block (U+E0000 to
 * U+E007F), which spells hidden ASCII.
 */
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|\udb40[\udc00-\udc7f]/g;

/** Look-alikes of angle brackets: full-width, small, mathematical, CJK. Read as < and > by a model. */
const LESS = /[\uff1c\ufe64\u2329\u27e8\u3008\u276c\u276e\u02c2]/g;
const MORE = /[\uff1e\ufe65\u232a\u27e9\u3009\u276d\u276f\u02c3]/g;

/** Bracketed role markers of chat templates: [INST], [/INST], [SYS], [SYSTEM], [ASSISTANT], [TOOL]. */
const ROLE_MARKER = /\[\s*(\/?)\s*(INST|SYS|SYSTEM|ASSISTANT|USER|TOOL|DEVELOPER|OVERTABLE)\s*\]/gi;

/**
 * A free field another party wrote, made inert before an agent reads it (docs/redteam-injection.md):
 *
 * - invisible and direction characters go, so what the agent reads is what the owner sees;
 * - full-width letters and digits become plain ones, so a disguised word reads as itself;
 * - every angle bracket, and its look-alikes, becomes ‹ or ›, so no text can open or close a tag,
 *   an envelope, a tool call or a chat template token (`<system>`, `</untrusted>`, `<|im_start|>`);
 * - bracketed role markers lose their brackets: `[INST]` becomes `(INST)`;
 * - other line separators become a plain new line.
 *
 * Words are kept: the owner reads the same text, and nothing is silently cut.
 */
export function agentText(value: string): string {
  return (
    value
      .replace(INVISIBLE, "")
      // Full-width ASCII (U+FF01 to U+FF5E) to ASCII, the brackets handled just below.
      .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[\u0085\u2028\u2029]/g, "\n")
      .replace(LESS, "<")
      .replace(MORE, ">")
      .replace(/</g, "\u2039")
      .replace(/>/g, "\u203a")
      .replace(ROLE_MARKER, (_m, slash: string, role: string) => `(${slash}${role})`)
  );
}

/** The free fields of typed params, each made inert; anything else is kept as is. */
export function agentParams<T>(value: T): T {
  if (typeof value === "string") return agentText(value) as T;
  if (Array.isArray(value)) return value.map((v) => agentParams(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, agentParams(v)])) as T;
  }
  return value;
}

/**
 * A name or label another bot chose, marked as data: in double quotes, with quotes, backslashes,
 * control characters and line separators escaped, so it cannot close the quote, start a line or
 * pass for a delimiter or a relay notice. The text is made inert first (agentText).
 */
export function asData(value: string): string {
  return JSON.stringify(agentText(value)).replace(/[\u0085\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** One line per image. URLs are re-serialized so a stored value cannot add lines. */
function describeImage(image: MessageImage): string {
  if (/^https:\/\//i.test(image.data)) {
    try {
      return new URL(image.data).href;
    } catch {
      return "(invalid image URL)";
    }
  }
  const kib = Math.max(1, Math.round(estimateImageBytes(image.data) / 1024));
  return `inline ${image.mimeType ?? "image"}, ${kib} KiB`;
}

/** The safety code says who the sender is to your human; a verified email only that the account's address is real. */
function accountLine(envelope: DeliveryEnvelope): string {
  if (envelope.accountVerified) {
    return "verified by your human (safety code)";
  }
  return envelope.senderEmailVerified ? "email verified (your human has not compared the safety code)" : "not verified";
}

export function formatDeliveredMessage(message: DeliveredMessage): string {
  const approval = message.requiresHumanApproval
    ? "\nrequiresHumanApproval: true (wait for your human before purchase, send, or post)"
    : "";
  const thread = message.threadId ? `\nthread: ${message.threadId}` : "";
  const room = message.room ? `\nroom: ${asData(message.room.name)} (id: ${message.room.id})` : "";
  const urgent = message.urgent ? "\nurgent: true" : "";
  const category = message.category && message.category !== "free_text" ? `\ncategory: ${message.category}` : "";
  const images = message.images.map((image, i) => `\nimage ${i + 1}: ${describeImage(image)}`);
  // The envelope comes from the relay's records; a relay without it says nothing about verification.
  const verified = message.envelope ? `\naccount: ${accountLine(message.envelope)}` : "";
  return [
    "-----",
    INFO_HEADER,
    TRUST_NOTE,
    "-----",
    `from: ${asData(message.from.botName)} (human: ${asData(message.from.humanName)}, id: ${message.from.id})${room}${verified}`,
    `at: ${message.createdAt}`,
    `id: ${message.id}${thread}${urgent}${category}${approval}${images.join("")}`,
    "",
    // Every body line is prefixed, so a sender cannot forge a "-----" delimiter
    // or a second header inside its own text.
    // Invisible and direction characters go too: the agent reads what the human would see.
    ...message.text.replace(INVISIBLE, "").split(/\r\n|[\r\n\u0085\u2028\u2029]/).map((l) => `| ${l}`),
    "-----",
  ].join("\n");
}
