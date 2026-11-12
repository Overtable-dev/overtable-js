import { describe, expect, it } from "vitest";
import { sendMessageSchema } from "./schemas.js";
import {
  BUILTIN_SHARING,
  SHARING_CATEGORIES,
  decideSharing,
  effectiveSharing,
  sharingLoosens,
  type SharingRuleSet,
} from "./sharing.js";

const NONE: SharingRuleSet = { defaults: {}, peer: {}, sensitive: false };

describe("sharing rules", () => {
  // Bots share freely since #152; finance, health, votes and commit are held, and since #341 location and contact details.
  it("allows most categories and holds finance, health, votes, commit, location and contact details when the human set nothing", () => {
    expect(BUILTIN_SHARING.free_text).toBe("allow");
    const held = ["finance", "health", "votes", "commit", "location", "contact_details"];
    for (const category of SHARING_CATEGORIES) {
      const decision = held.includes(category) ? "ask" : "allow";
      expect(decideSharing(NONE, category, 0), category).toEqual({ decision, category });
    }
  });

  it("lets a peer rule win over the default rule, and the default over the built-in", () => {
    const rules: SharingRuleSet = { defaults: { location: "allow", free_text: "deny" }, peer: { location: "deny" }, sensitive: false };
    expect(decideSharing(rules, "location", 0).decision).toBe("deny");
    expect(decideSharing({ ...rules, peer: {} }, "location", 0).decision).toBe("allow");
    expect(decideSharing(rules, "free_text", 0).decision).toBe("deny");
  });

  it("holds free_text for a sensitive peer but never loosens a deny", () => {
    expect(decideSharing({ ...NONE, sensitive: true }, "free_text", 0).decision).toBe("ask");
    expect(decideSharing({ ...NONE, peer: { free_text: "allow" }, sensitive: true }, "free_text", 0).decision).toBe("ask");
    expect(decideSharing({ ...NONE, peer: { free_text: "deny" }, sensitive: true }, "free_text", 0).decision).toBe("deny");
    expect(effectiveSharing({ ...NONE, sensitive: true }).free_text).toBe("ask");
  });

  it("checks images against a documents rule only when the human set one", () => {
    expect(decideSharing(NONE, "free_text", 2)).toEqual({ decision: "allow", category: "free_text" });
    expect(decideSharing({ ...NONE, defaults: { documents: "ask" } }, "free_text", 1)).toEqual({
      decision: "ask",
      category: "documents",
    });
    expect(decideSharing({ ...NONE, peer: { documents: "deny" } }, "availability", 1)).toEqual({
      decision: "deny",
      category: "documents",
    });
    // A stricter declared category keeps its own decision.
    expect(decideSharing({ ...NONE, defaults: { documents: "allow", health: "deny" } }, "health", 1)).toEqual({
      decision: "deny",
      category: "health",
    });
  });

  it("defaults a send to free_text and refuses an unknown category", () => {
    const base = { toBotId: "00000000-0000-4000-8000-000000000000", text: "hi" };
    expect(sendMessageSchema.parse(base).category).toBe("free_text");
    expect(sendMessageSchema.parse({ ...base, category: "health" }).category).toBe("health");
    const unknown = sendMessageSchema.safeParse({ ...base, category: "secrets" });
    expect(unknown.success).toBe(false);
    expect(unknown.error?.errors[0]?.message).toContain("category must be one of free_text");
  });

  it("tells a loosening from a tightening, images and sensitive included", () => {
    const loosens = (before: Partial<SharingRuleSet>, after: Partial<SharingRuleSet>) =>
      sharingLoosens({ ...NONE, ...before }, { ...NONE, ...after });
    // finance: its built-in default is ask, so allowing it loosens (location and contact_details ask too since #341).
    expect(loosens({}, { defaults: { finance: "allow" } })).toBe(true);
    expect(loosens({}, { defaults: { finance: "deny" } })).toBe(false);
    expect(loosens({ peer: { finance: "deny" } }, {})).toBe(true);
    expect(loosens({ peer: { finance: "allow" } }, {})).toBe(false);
    expect(loosens({ sensitive: true }, {})).toBe(true);
    expect(loosens({}, { sensitive: true })).toBe(false);
    // Removing a documents ask rule lets documents (built-in allow since #152) and images in
    // free_text through again.
    expect(loosens({ defaults: { documents: "ask" } }, {})).toBe(true);
    expect(loosens({}, { defaults: { documents: "ask" } })).toBe(false);
    expect(loosens({ defaults: { location: "allow" } }, { defaults: { location: "allow" } })).toBe(false);
  });
});
