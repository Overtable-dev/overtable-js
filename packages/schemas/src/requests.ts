import { z } from "zod";
import { REQUEST_CREATE_TYPES, REQUEST_TYPES, SHARE_CATEGORIES, requestToolInputs, shareInput, shareSchemas, type RequestType, type ShareCategory } from "@overtable/shared";

/**
 * Structured requests (docs/requests.md): the payload of a slot, a quote, an order or a poll, as
 * request_create and request_answer take them, and the typed share with one strict schema per
 * category. Built by the relay's own code (packages/shared), with this package's zod: the relay
 * applies exactly these, then the owner's rules.
 */

const inputs = requestToolInputs(z) as { request_create: Record<string, z.ZodTypeAny> };

/** The payload schemas of the four answerable request types. */
export const REQUEST_PAYLOAD_SCHEMAS: Readonly<Record<RequestType, z.ZodTypeAny>> = Object.fromEntries(
  REQUEST_TYPES.map((type) => [type, (inputs.request_create[type] as z.ZodOptional<z.ZodTypeAny>).unwrap()]),
) as Record<RequestType, z.ZodTypeAny>;

/** One strict schema per share category: the payload of `{ type: "share", share: { category, payload } }`. */
export const SHARE_SCHEMAS: Readonly<Record<ShareCategory, z.ZodTypeAny>> = shareSchemas(z) as Record<ShareCategory, z.ZodTypeAny>;

/** `{ category, payload }`, one branch per category. Any other shape is refused. */
export const SHARE_INPUT_SCHEMA: z.ZodTypeAny = shareInput(z) as z.ZodTypeAny;

/** The whole argument object of the request_create tool (MCP). */
export const REQUEST_CREATE_SCHEMA = z.object(inputs.request_create);
/** The whole argument object of the request_answer tool (MCP). */
export const REQUEST_ANSWER_SCHEMA = z.object((requestToolInputs(z) as { request_answer: Record<string, z.ZodTypeAny> }).request_answer);

export { REQUEST_TYPES, REQUEST_CREATE_TYPES, SHARE_CATEGORIES };
