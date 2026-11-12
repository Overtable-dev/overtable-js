import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import { PAIR_SCHEMAS } from "./pairs.js";
import { REQUEST_ANSWER_SCHEMA, REQUEST_CREATE_SCHEMA, REQUEST_PAYLOAD_SCHEMAS, SHARE_INPUT_SCHEMA, SHARE_SCHEMAS } from "./requests.js";

/**
 * The JSON Schema form (draft-07, which every validator reads) of every schema of this package. Written to dist/json-schema/ at build time
 * (scripts/publish/build.mjs), so a reader in any language needs no zod. Refinements that JSON
 * Schema cannot say (a time zone that exists, a window that ends after it starts) are only in the
 * Zod form; the relay applies them.
 */
export type JsonSchema = Record<string, unknown>;

/**
 * zod-to-json-schema escapes every non-word character of a literal prefix ("https://" becomes
 * "https\\:\\/\\/"). "\\:" is not a valid escape in a Unicode regular expression, which ajv and most
 * validators use: keep the colon bare.
 */
function unicodeSafe(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(unicodeSafe);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node).map(([k, v]) => [k, k === "pattern" && typeof v === "string" ? v.replace(/\\:/g, ":") : unicodeSafe(v)]),
  );
}

function convert(schema: z.ZodTypeAny, name: string): JsonSchema {
  // The cast keeps tsc from expanding zod-to-json-schema's generic types for every schema (TS2589).
  const toJson = zodToJsonSchema as unknown as (schema: unknown, options: Record<string, unknown>) => unknown;
  const json = unicodeSafe(toJson(schema, { target: "jsonSchema7", $refStrategy: "none" })) as JsonSchema;
  return { $schema: json.$schema, title: name, ...json };
}

/** Path under dist/json-schema/ to its JSON Schema. */
export function jsonSchemaFiles(): Record<string, JsonSchema> {
  const files: Record<string, JsonSchema> = {};
  for (const [pair, { ask, answer }] of Object.entries(PAIR_SCHEMAS)) {
    files[`pairs/${pair}.ask.json`] = convert(ask, `${pair}.ask`);
    files[`pairs/${pair}.answer.json`] = convert(answer, `${pair}.answer`);
  }
  for (const [type, schema] of Object.entries(REQUEST_PAYLOAD_SCHEMAS)) files[`requests/${type}.json`] = convert(schema, type);
  files["requests/request_create.json"] = convert(REQUEST_CREATE_SCHEMA, "request_create");
  files["requests/request_answer.json"] = convert(REQUEST_ANSWER_SCHEMA, "request_answer");
  for (const [category, schema] of Object.entries(SHARE_SCHEMAS)) files[`share/${category}.json`] = convert(schema, category);
  files["share/share.json"] = convert(SHARE_INPUT_SCHEMA, "share");
  return files;
}
