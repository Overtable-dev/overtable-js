import { z } from "zod";
import { EXCHANGE_PAIRS, QUOTE_UNITS, RATE_UNITS, type ExchangePair } from "@overtable/shared";

/**
 * The shape of each exchange pair (docs/protocol/exchanges.md): what an asking agent may send as
 * params, what the owner's agent may send back as its answer. Every object is strict: an unknown
 * field fails.
 *
 * These are the relay's schemas (packages/relay/src/exchanges/pairs.ts) without its content
 * filters. A value these refuse, the relay refuses. A value these accept can still be refused by
 * the relay when free text names a contact detail, an amount where none belongs, or what a note
 * may not carry, when an amount cannot be read exactly in its currency, or by the owner's rules.
 * The tests of this package hold both sides to that (src/pairs.test.ts).
 */

const line = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\r\n<>]+$/, "One line, no angle brackets");
/** Several lines, bounded, without control characters other than new lines and tabs. */
const prose = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/, "No control characters");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const instant = z
  .string()
  .min(10)
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), "ISO 8601 date-time");
const currency = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, upper case");
/** An amount in the currency's major unit: "450", "450.50", 450.5. */
const money = z.union([
  z.string().regex(/^\d{1,9}(?:[.,]\d{1,2})?$/, "An amount such as 450 or 450.50"),
  z.number().nonnegative().finite().max(999_999_999),
]);

export const MAX_FREEBUSY_DAYS = 31;
export const MAX_NEED = 500;
export const MAX_MESSAGE = 2000;
export const MAX_SLOT_TIMES = 3;
export const MAX_QUOTE_QUANTITY = 10_000;
export const MAX_RECOMMENDATION = 500;
export const MAX_PREFERENCES = 10;

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const freebusyAsk = z
  .object({
    from: day,
    to: day,
    granularity: z.enum(["day", "hour"]).optional(),
    timeZone: z.string().min(1).max(64).optional(),
  })
  .superRefine((v, ctx) => {
    const span = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
    if (Number.isNaN(span) || span < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "to must be on or after from" });
    if (span > MAX_FREEBUSY_DAYS) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${MAX_FREEBUSY_DAYS} days` });
    if (v.timeZone !== undefined && !validZone(v.timeZone)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown timeZone" });
  });

export const freebusyAnswer = z
  .object({
    timeZone: z.string().min(1).max(64),
    free: z.array(z.object({ from: instant, to: instant }).strict()).max(50),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!validZone(v.timeZone)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown timeZone" });
    for (const [i, w] of v.free.entries()) {
      if (Date.parse(w.to) <= Date.parse(w.from)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `free[${i}]: to must be after from` });
    }
  });

export const offersAnswer = z
  .object({
    currency,
    items: z
      .array(z.object({ id: line(64), label: line(120), amount: money, unit: line(40).optional(), conditions: line(300).optional() }).strict())
      .max(50),
  })
  .strict();

export const rateAnswer = z.object({ currency, min: money, max: money, unit: z.enum(RATE_UNITS), conditions: line(300).optional() }).strict();

export const scopeAnswer = z.object({ fit: z.enum(["yes", "partly", "no"]), note: line(300).optional() }).strict();

export const channelAnswer = z
  .object({ channel: z.enum(["email", "phone", "form"]), value: line(200) })
  .strict()
  .superRefine((v, ctx) => {
    const ok =
      v.channel === "email"
        ? /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(v.value)
        : v.channel === "phone"
          ? /^\+?[\d\s().-]{6,24}$/.test(v.value) && v.value.replace(/\D/g, "").length >= 6
          : /^https:\/\/[^\s<>]+$/.test(v.value);
    if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `value is not a valid ${v.channel === "form" ? "https form URL" : v.channel}` });
  });

export const slotAsk = z
  .object({
    propose: z.array(z.object({ when: instant }).strict()).min(1).max(MAX_SLOT_TIMES),
    durationMinutes: z.number().int().min(5).max(8 * 60).optional(),
  })
  .strict();
export const slotAnswer = z.union([
  z.object({ accept: z.number().int().min(0).max(MAX_SLOT_TIMES - 1) }).strict(),
  z.object({ counter: z.object({ when: instant }).strict() }).strict(),
]);

export const quoteRequest = z
  .object({
    service: line(120),
    need: prose(MAX_NEED),
    budget: z.object({ amount: money, currency }).strict().optional(),
    dates: z
      .object({ from: day, to: day.optional() })
      .strict()
      .refine((d) => !d.to || d.to >= d.from, "dates.to must be on or after dates.from")
      .optional(),
  })
  .strict();
export const quoteAsk = z.union([quoteRequest, z.object({ accept: z.literal(true) }).strict()]);
export const quoteAnswer = z
  .object({
    amount: money,
    currency,
    unit: z.enum(QUOTE_UNITS),
    quantity: z
      .number()
      .positive()
      .max(MAX_QUOTE_QUANTITY)
      .refine((q) => Math.abs(q * 100 - Math.round(q * 100)) < 1e-6, "quantity: at most two decimals")
      .optional(),
    validUntil: day,
    conditions: line(300).optional(),
  })
  .strict();

/** An https link, without credentials: the one place a recommendation may name a page. */
const httpsLink = z
  .string()
  .trim()
  .max(500)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "link: an https URL");

export const recommendationAnswer = z.object({ recommendation: line(MAX_RECOMMENDATION), link: httpsLink.optional() }).strict();
export const preferencesAnswer = z.object({ preferences: z.array(line(200)).min(1).max(MAX_PREFERENCES) }).strict();
export const noteAsk = z.object({ text: prose(4000) }).strict();

export interface PairSchema {
  /** The params the asking agent sends with exchange_ask (or a door visitor, for slot and quote). */
  ask: z.ZodTypeAny;
  /** The answer the owner's agent sends with exchange_answer. */
  answer: z.ZodTypeAny;
}

export const PAIR_SCHEMAS: Readonly<Record<ExchangePair, PairSchema>> = {
  "calendar.freebusy": { ask: freebusyAsk, answer: freebusyAnswer },
  "offers.list": { ask: z.object({ query: line(200).optional() }).strict(), answer: offersAnswer },
  "rate.range": { ask: z.object({ service: line(200) }).strict(), answer: rateAnswer },
  "scope.ask": { ask: z.object({ need: prose(MAX_NEED) }).strict(), answer: scopeAnswer },
  "contact.channel": { ask: z.object({}).strict(), answer: channelAnswer },
  "recommendation.ask": { ask: z.object({ topic: line(200) }).strict(), answer: recommendationAnswer },
  "preferences.ask": { ask: z.object({ context: line(200) }).strict(), answer: preferencesAnswer },
  message: { ask: z.object({ text: prose(MAX_MESSAGE) }).strict(), answer: z.object({}).strict() },
  note: { ask: noteAsk, answer: z.object({}).strict() },
  "overtable.ping": { ask: z.object({}).strict(), answer: z.object({ reply: line(300) }).strict() },
  slot: { ask: slotAsk, answer: slotAnswer },
  quote: { ask: quoteAsk, answer: quoteAnswer },
};

/** The pair's schema, or undefined for a name that is not in the catalogue. */
export function pairSchema(pair: string): PairSchema | undefined {
  return (EXCHANGE_PAIRS as readonly string[]).includes(pair) ? PAIR_SCHEMAS[pair as ExchangePair] : undefined;
}
