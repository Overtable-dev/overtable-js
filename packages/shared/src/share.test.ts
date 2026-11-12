import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BUILTIN_SHARING } from "./sharing.js";
import { SHARE_CATEGORIES, shareInput, shareSchemas, shareSummary, type ShareCategory } from "./share.js";

const schemas = shareSchemas(z);

/** One payload per category that its schema accepts. */
const VALID: Record<ShareCategory, Record<string, unknown>> = {
  availability: { title: "Next week", timeZone: "Europe/Paris", free: [{ from: "2026-11-10T09:00:00+01:00", to: "2026-11-10T12:00:00+01:00" }] },
  finance: { title: "Rent share", kind: "amount", amount: { value: 640, currency: "EUR" }, reference: "November" },
  health: { title: "Allergy note", kind: "allergy", subject: "Lily", details: "Peanuts, carries an epipen", severity: "high" },
  contact_details: { title: "Plumber", name: "Rui Costa", phone: "+351 912 345 678" },
  location: { title: "Hotel", place: "Casa do Bairro", address: "Rua das Flores 12, Lisboa", lat: 38.71, lng: -9.14 },
  documents: { title: "Client files", items: [{ name: "acme-contract.pdf", mediaType: "application/pdf", sizeBytes: 120_000, sha256: "a".repeat(64) }] },
  preferences: { title: "Dinner", items: [{ topic: "food", value: "No fish" }] },
};

/** One payload per category that its schema refuses, and why. */
const INVALID: Record<ShareCategory, Record<string, unknown>> = {
  availability: { title: "Next week", free: [{ from: "2026-11-10T12:00:00+01:00", to: "2026-11-10T09:00:00+01:00" }] }, // ends before it starts
  finance: { title: "Rent share", kind: "amount", amount: { value: 640, currency: "euros" } }, // not ISO 4217
  health: { title: "Allergy note", kind: "allergy" }, // no details
  contact_details: { title: "Plumber", name: "Rui Costa" }, // a name alone is no contact detail
  location: { title: "Hotel", lat: 38.71 }, // lat without lng
  documents: { title: "Client files", items: [{ name: "a.pdf", url: "http://example.com/a.pdf" }] }, // not https
  preferences: { title: "Dinner", items: [{ topic: "food", value: "No fish" }], secret: "x" }, // unknown field
};

describe("share schemas", () => {
  for (const category of SHARE_CATEGORIES) {
    it(`${category}: accepts a valid payload and refuses an invalid one`, () => {
      expect(schemas[category].safeParse(VALID[category]).success).toBe(true);
      expect(schemas[category].safeParse(INVALID[category]).success).toBe(false);
      // The request_create input takes the same payloads under their category, and no other.
      const input = shareInput(z);
      expect(input.safeParse({ category, payload: VALID[category] }).success).toBe(true);
      expect(input.safeParse({ category, payload: INVALID[category] }).success).toBe(false);
    });
  }

  it("refuses a title that is not a short label, and a payload of another category", () => {
    expect(schemas.health.safeParse({ ...VALID.health, title: "x".repeat(81) }).success).toBe(false);
    expect(schemas.health.safeParse({ ...VALID.health, title: "<b>Allergy</b>" }).success).toBe(false);
    expect(shareInput(z).safeParse({ category: "health", payload: VALID.preferences }).success).toBe(false);
    expect(shareInput(z).safeParse({ category: "free_text", payload: { title: "Hi" } }).success).toBe(false);
  });

  it("keeps health and finance on ask by default", () => {
    expect(BUILTIN_SHARING.health).toBe("ask");
    expect(BUILTIN_SHARING.finance).toBe("ask");
  });

  it("summarises the shape of a payload, never its values but the title", () => {
    for (const category of SHARE_CATEGORIES) {
      const payload = schemas[category].parse(VALID[category]) as Record<string, unknown>;
      const summary = shareSummary(category, payload);
      expect(summary).toContain(`"${String(payload.title)}"`);
      for (const value of leaves(payload)) {
        if (value === payload.title || value.length < 3) continue;
        expect([category, summary.includes(value)]).toEqual([category, false]);
      }
    }
    expect(shareSummary("health", VALID.health)).toBe('Share (health): "Allergy note", allergy, severity high.');
    expect(shareSummary("contact_details", VALID.contact_details)).toBe('Share (contact details): "Plumber", a name, a phone number.');
  });
});

/** Every string and number of a payload, as text; kind and severity are the shape the summary names. */
function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([k]) => k !== "kind" && k !== "severity")
      .flatMap(([, v]) => leaves(v));
  }
  return [];
}
