import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { REQUEST_TYPES, SHARE_CATEGORIES } from "@overtable/shared";
import { jsonSchemaFiles } from "./json-schema.js";
import { REQUEST_ANSWER_SCHEMA, REQUEST_CREATE_SCHEMA, REQUEST_PAYLOAD_SCHEMAS, SHARE_INPUT_SCHEMA, SHARE_SCHEMAS } from "./requests.js";

describe("@overtable/schemas: requests and shares, built by the relay's own code", () => {
  it("has a payload schema per request type and a schema per share category", () => {
    expect(Object.keys(REQUEST_PAYLOAD_SCHEMAS).sort()).toEqual([...REQUEST_TYPES].sort());
    expect(Object.keys(SHARE_SCHEMAS).sort()).toEqual([...SHARE_CATEGORIES].sort());
  });

  it("checks a slot, a quote, an order and a poll", () => {
    expect(REQUEST_PAYLOAD_SCHEMAS.slot.safeParse({ when: "2026-11-07T20:00+01:00", service: "Lunch", partySize: 2 }).success).toBe(true);
    expect(REQUEST_PAYLOAD_SCHEMAS.quote.safeParse({ title: "Logo", amount: "450 EUR" }).success).toBe(true);
    expect(REQUEST_PAYLOAD_SCHEMAS.order.safeParse({ title: "Bread", items: [] }).success).toBe(false);
    expect(REQUEST_PAYLOAD_SCHEMAS.poll.safeParse({ question: "Where?", options: ["Here"] }).success).toBe(false);
    expect(REQUEST_CREATE_SCHEMA.safeParse({ type: "slot", to: "@camille", slot: { when: "2026-11-07T20:00+01:00" } }).success).toBe(true);
    expect(REQUEST_ANSWER_SCHEMA.safeParse({ requestId: "1b4e28ba-2fa1-11d2-883f-0016d3cca427", answer: "maybe" }).success).toBe(false);
  });

  it("a share is strict: an unknown field refuses it", () => {
    const health = { title: "Allergy note", kind: "allergy", details: "Peanuts", severity: "high" };
    expect(SHARE_INPUT_SCHEMA.safeParse({ category: "health", payload: health }).success).toBe(true);
    expect(SHARE_INPUT_SCHEMA.safeParse({ category: "health", payload: { ...health, extra: 1 } }).success).toBe(false);
    expect(SHARE_INPUT_SCHEMA.safeParse({ category: "votes", payload: health }).success).toBe(false);
  });

  it("the JSON Schema form says the same about strictness", () => {
    const ajv = new Ajv({ strict: false });
    const files = jsonSchemaFiles();
    const share = ajv.compile(files["share/health.json"]!);
    expect(share({ title: "Allergy note", kind: "allergy", details: "Peanuts" })).toBe(true);
    expect(share({ title: "Allergy note", kind: "allergy", details: "Peanuts", extra: 1 })).toBe(false);
    for (const [path, schema] of Object.entries(files)) expect(() => ajv.compile(schema), path).not.toThrow();
  });
});
