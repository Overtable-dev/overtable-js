import { z } from "zod";
import { REPLY_MAX_MINUTES, ROOM_MAX_MEMBERS_HARD_LIMIT, ROOM_MIN_MEMBERS } from "./constants.js";
import { MAX_EMAIL_LENGTH, normalizeEmailAddress } from "./email.js";
import { COMMIT_CATEGORY, SHARING_CATEGORIES, SHARING_DECISIONS } from "./sharing.js";

export const MAX_TEXT = 16_000;
export const MAX_IMAGES = 8;
/** Per-image payload size (decoded or URL length), ~1 MiB. */
export const MAX_IMAGE_BYTES = 1_048_576;
export const MAX_IMAGE_DATA_CHARS = Math.ceil(MAX_IMAGE_BYTES * (4 / 3)) + 128;
export const MAX_IMAGE_URL_CHARS = 2048;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/** Largest valid send body: every image at its cap, text at its cap, plus JSON overhead. */
export const MAX_SEND_BODY_BYTES = MAX_IMAGES * MAX_IMAGE_DATA_CHARS + MAX_TEXT * 6 + 64 * 1024;
/** Every other JSON body. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

// C0/C1 controls (newlines included) and bidi overrides. Names and thread ids are
// echoed into headers of text shown to models, so they must stay on one visible line.
const UNSAFE_CHARS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;
const UNSAFE_CHARS_GLOBAL = /[\p{Cc}\u202A-\u202E\u2066-\u2069\u2028\u2029]/gu;

function singleLine(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !UNSAFE_CHARS.test(v), "Must not contain control characters");
}

export const registerBotSchema = z.object({
  botName: singleLine(80),
  humanName: singleLine(80),
});

export const MAX_WEBHOOK_HEADERS = 8;
export const MAX_WEBHOOK_HEADER_NAME = 64;
export const MAX_WEBHOOK_HEADER_VALUE = 1024;
/** Sum of `name: value\r\n` over all extra headers. */
export const MAX_WEBHOOK_HEADERS_BYTES = 4096;

// RFC 9110 token.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// Visible ASCII, with inner spaces and tabs. No CR, LF, NUL or other controls.
const HEADER_VALUE = /^[\x21-\x7e]([\x20-\x7e\t]*[\x21-\x7e])?$/;

/**
 * Names the relay sets itself or that change how the request is framed or routed.
 * Hop-by-hop headers (RFC 9110 7.6.1) plus Host, Content-Length, Expect and the
 * relay's own content-type and signature headers.
 */
const REFUSED_HEADER_NAMES = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "content-type",
  "expect",
]);

export function isRefusedWebhookHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return REFUSED_HEADER_NAMES.has(lower) || lower.startsWith("x-relais-");
}

// Error messages may name a header but never echo its value: they reach the
// response body and possibly logs.
const webhookHeaderSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_WEBHOOK_HEADER_NAME)
    .regex(HEADER_NAME, "Header name must be an HTTP token"),
  value: z
    .string()
    .min(1, "Header value must not be empty")
    .max(MAX_WEBHOOK_HEADER_VALUE, `Header value exceeds ${MAX_WEBHOOK_HEADER_VALUE} characters`)
    .regex(HEADER_VALUE, "Header value must be printable ASCII without control characters"),
});

export const webhookHeadersSchema = z
  .array(webhookHeaderSchema)
  .max(MAX_WEBHOOK_HEADERS, `At most ${MAX_WEBHOOK_HEADERS} extra headers`)
  .superRefine((headers, ctx) => {
    const seen = new Set<string>();
    let bytes = 0;
    for (const { name, value } of headers) {
      bytes += name.length + value.length + 4;
      // Invalid names already failed above; do not echo them.
      if (name.length > MAX_WEBHOOK_HEADER_NAME || !HEADER_NAME.test(name)) {
        continue;
      }
      const lower = name.toLowerCase();
      if (isRefusedWebhookHeaderName(name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Header ${lower} is not allowed` });
      }
      if (seen.has(lower)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Header ${lower} appears twice` });
      }
      seen.add(lower);
    }
    if (bytes > MAX_WEBHOOK_HEADERS_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Extra headers exceed ${MAX_WEBHOOK_HEADERS_BYTES} bytes`,
      });
    }
  });

export const webhookConfigSchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine((v) => {
      const u = new URL(v);
      return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password;
    }, "Webhook URL must be http(s) without credentials"),
  secret: z.string().min(16).max(256),
  headers: webhookHeadersSchema.optional().default([]),
});

export const clearWebhookSchema = z.object({
  clear: z.literal(true),
});

/** A plain address, normalized by normalizeEmailAddress. */
export const emailAddressSchema = z
  .string()
  .max(MAX_EMAIL_LENGTH)
  .transform((value, ctx) => {
    const address = normalizeEmailAddress(value);
    if (!address) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "address must be a plain email address like name+overtable@example.com",
      });
      return z.NEVER;
    }
    return address;
  });

export const wakeEmailSchema = z.object({
  address: emailAddressSchema,
});

/**
 * Claude Code API fire URL. Host must be exactly api.anthropic.com (SSRF guard). Path:
 * /v1/claude_code/routines/trig_<id>/fire
 */
export const CLAUDE_FIRE_URL_RE =
  /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9_-]+\/fire$/;

export const wakeFireSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => CLAUDE_FIRE_URL_RE.test(value), {
      message: "fireUrl must be https://api.anthropic.com/v1/claude_code/routines/trig_…/fire",
    }),
  token: z
    .string()
    .trim()
    .min(20)
    .max(512)
    .refine((value) => value.startsWith("sk-ant-oat01-"), {
      message: "fireToken must be a per-routine bearer token (sk-ant-oat01-…)",
    }),
});

const imageSchema = z.object({
  data: z.string().min(1).max(MAX_IMAGE_DATA_CHARS),
  mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES).optional(),
});

export const sharingCategorySchema = z.enum(SHARING_CATEGORIES, {
  errorMap: () => ({ message: `category must be one of ${SHARING_CATEGORIES.join(", ")}` }),
});

/** Numeric fields a sender declares for its organisation's approval rules, such as {"discount_percent": 15}. */
export const MAX_APPROVAL_FIELDS = 8;
export const approvalFieldsSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "approvalFields keys: lowercase letters, digits and _, starting with a letter"), z.number().finite())
  .refine((fields) => Object.keys(fields).length <= MAX_APPROVAL_FIELDS, `At most ${MAX_APPROVAL_FIELDS} approvalFields`);

export const sendMessageSchema = z.object({
  toBotId: z.string().uuid(),
  text: z.string().trim().min(1).max(MAX_TEXT),
  images: z.array(imageSchema).max(MAX_IMAGES).optional().default([]),
  urgent: z.boolean().optional().default(false),
  threadId: singleLine(128).nullable().optional().default(null),
  requiresHumanApproval: z.boolean().optional().default(false),
  category: sharingCategorySchema.optional().default("free_text"),
  approvalFields: approvalFieldsSchema.optional(),
  /** Ask the recipient for a reply: the message then wakes it, and the sender can follow the answer. */
  replyRequested: z.boolean().optional(),
  /** How long the sender waits for that reply, in minutes. Default REPLY_DEFAULT_MINUTES. */
  replyWithinMinutes: z.number().int().min(1).max(REPLY_MAX_MINUTES).optional(),
});

/** base64url, as produced by generateInviteCode (older codes are 12 characters). */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

export const redeemInviteSchema = z.object({
  code: z.string().trim().min(6).max(64),
});

// The relay checks the code format itself and answers 404, like GET /j/:code.
export const joinSchema = registerBotSchema.extend({
  code: z.string().trim(),
});

export const acceptContactSchema = z.object({
  peerBotId: z.string().uuid(),
});

export const removeContactSchema = z.object({
  peerBotId: z.string().uuid(),
});

export const blockSchema = z.object({
  peerBotId: z.string().uuid(),
});

export const createRoomSchema = z
  .object({
    name: singleLine(80),
    /** Active contacts of the creator to add at once. With this list, size must be 3 to max. */
    memberBotIds: z.array(z.string().uuid()).max(ROOM_MAX_MEMBERS_HARD_LIMIT - 1).optional().default([]),
  })
  .superRefine((value, ctx) => {
    if (value.memberBotIds.length === 0) {
      return;
    }
    if (new Set(value.memberBotIds).size !== value.memberBotIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each member may appear only once", path: ["memberBotIds"] });
    }
    const size = value.memberBotIds.length + 1;
    if (size < ROOM_MIN_MEMBERS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A group needs at least ${ROOM_MIN_MEMBERS} members (you included)`,
        path: ["memberBotIds"],
      });
    }
  });

/** Room id, or groupId as the same id (groups reuse rooms). */
function roomRefFields() {
  return {
    roomId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
  };
}

function resolveRoomId(
  value: { roomId?: string | undefined; groupId?: string | undefined },
  ctx: z.RefinementCtx,
): string {
  const roomId = value.roomId;
  const groupId = value.groupId;
  if (roomId && groupId && roomId !== groupId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "roomId and groupId must be the same when both are set" });
    return z.NEVER;
  }
  const id = roomId ?? groupId;
  if (!id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "roomId or groupId is required" });
    return z.NEVER;
  }
  return id;
}

export const roomIdSchema = z
  .object(roomRefFields())
  .transform((value, ctx) => ({ roomId: resolveRoomId(value, ctx) }));

export const roomMemberSchema = z
  .object({
    ...roomRefFields(),
    botId: z.string().uuid(),
  })
  .transform((value, ctx) => ({ roomId: resolveRoomId(value, ctx), botId: value.botId }));

export const redeemRoomInviteSchema = redeemInviteSchema;

export const sendRoomMessageSchema = z
  .object({
    ...roomRefFields(),
    text: z.string().trim().min(1).max(MAX_TEXT),
    images: z.array(imageSchema).max(MAX_IMAGES).optional().default([]),
    urgent: z.boolean().optional().default(false),
    requiresHumanApproval: z.boolean().optional().default(false),
    category: sharingCategorySchema.optional().default("free_text"),
    approvalFields: approvalFieldsSchema.optional(),
  })
  .transform((value, ctx) => {
    const roomId = resolveRoomId(value, ctx);
    return {
      roomId,
      text: value.text,
      images: value.images,
      urgent: value.urgent,
      requiresHumanApproval: value.requiresHumanApproval,
      category: value.category,
      ...(value.approvalFields !== undefined ? { approvalFields: value.approvalFields } : {}),
    };
  });

/** peerBotId null: the default rule for every recipient. inherit removes the rule. */
export const setSharingRuleSchema = z.object({
  peerBotId: z.string().uuid().nullable(),
  category: sharingCategorySchema.refine((c) => c !== COMMIT_CATEGORY, "commit always waits for the human's confirmation: no rule can change it"),
  decision: z.enum([...SHARING_DECISIONS, "inherit"]),
});

export const setSensitiveSchema = z.object({
  peerBotId: z.string().uuid(),
  sensitive: z.boolean(),
});

export const heldMessageSchema = z.object({
  messageId: z.string().uuid(),
});

/** Operator recovery: a human account after a lost device, or a bot that has no account yet. */
export const adminOAuthClientDeleteSchema = z.object({
  clientId: z.string().min(1).max(200),
});

export const adminRecoverSchema = z
  .object({
    humanId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "humanId is an account id").optional(),
    botId: z.string().uuid().optional(),
  })
  .refine((v) => (v.humanId === undefined) !== (v.botId === undefined), "Give exactly one of humanId and botId");

/** Operator only: flag the account of a bot (or an account) as a test account, or clear the flag. */
export const adminTestAccountSchema = z
  .object({
    humanId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "humanId is an account id").optional(),
    botId: z.string().uuid().optional(),
    test: z.boolean(),
  })
  .refine((v) => (v.humanId === undefined) !== (v.botId === undefined), "Give exactly one of humanId and botId");

/** A human account's display name, and a bot name chosen by the human. */
export const displayNameSchema = singleLine(80);

/** A bot's name as its human sets it (consent, Rename): 1 to 60 characters, one line, no < or >. */
export const BOT_NAME_MAX = 60;
export const botNameSchema = singleLine(BOT_NAME_MAX)
  .refine((v) => !/[\u2028\u2029]/.test(v), "A bot name is one line")
  .refine((v) => !/[<>]/.test(v), "A bot name cannot contain < or >");

/** A bot name made from something else (an OAuth client name): the same rules, never empty. */
export function toBotName(value: string): string {
  const cleaned = value.replace(UNSAFE_CHARS_GLOBAL, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, BOT_NAME_MAX).trim();
  return cleaned || "Bot";
}

export const humanEmailSchema = z.object({
  address: emailAddressSchema,
});

export const readMessagesSchema = z.object({
  markRead: z.boolean().optional().default(true),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export type RegisterBotInput = z.infer<typeof registerBotSchema>;
export type JoinInput = z.infer<typeof joinSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SendRoomMessageInput = z.infer<typeof sendRoomMessageSchema>;
export type SetSharingRuleInput = z.infer<typeof setSharingRuleSchema>;
export type WebhookConfigInput = z.infer<typeof webhookConfigSchema>;
export type WakeEmailInput = z.infer<typeof wakeEmailSchema>;
export type WebhookHeader = z.infer<typeof webhookHeaderSchema>;
