import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  REQUEST_COMMIT_TYPES,
  REQUEST_TYPES,
  requestTypeLabel,
  describeRequestList,
  requestAnswerCategory,
  quoteMoney,
  requestCardLinesFr,
  requestFallbackText,
  requestToolInputs,
} from "./request-tools.js";

describe("request-tools", () => {
  it("covers the four types with their labels and commit rules", () => {
    expect([...REQUEST_TYPES]).toEqual(["slot", "quote", "order", "poll"]);
    expect(requestTypeLabel("slot")).toBe("Slot");
    expect(requestTypeLabel("slot", "fr")).toBe("Créneau");
    expect(requestTypeLabel("poll", "fr")).toBe("Sondage");
    expect(REQUEST_COMMIT_TYPES.has("slot")).toBe(true);
    expect(REQUEST_COMMIT_TYPES.has("poll")).toBe(false);
    // The category of the owner's own accept or counter: a time is availability, a price is finance.
    // An agent's own accept or counter is held as a commitment by the relay (#322).
    expect(requestAnswerCategory("slot", "accept")).toBe("availability");
    expect(requestAnswerCategory("quote", "counter")).toBe("finance");
    expect(requestAnswerCategory("order", "counter")).toBe("finance");
    expect(requestAnswerCategory("poll", "vote")).toBe("votes");
    expect(requestAnswerCategory("quote", "refuse")).toBe("free_text");
  });

  it("builds readable fallback text and French card lines for each type", () => {
    expect(requestFallbackText("slot", { when: "Friday 8pm", partySize: 4 })).toContain("Proposed slot: Friday 8pm, 4 people");
    expect(requestFallbackText("quote", { title: "Catering", amount: "45 EUR" })).toContain('Quote "Catering": 45 EUR');
    expect(requestFallbackText("order", { title: "Table", items: [{ label: "Thai", quantity: 2 }] })).toContain("Thai x2");
    expect(requestFallbackText("poll", { question: "Where?", options: ["Thai", "Pizza"] })).toContain("Options: Thai | Pizza");

    expect(requestCardLinesFr("slot", { when: "vendredi 20h", partySize: 4 })[0]).toBe("Quand : vendredi 20h");
    expect(requestCardLinesFr("quote", { title: "Traiteur", amount: "45 EUR" })[1]).toBe("Montant : 45 EUR");
    expect(describeRequestList([])).toContain("request_create");
  });

  it("writes the currency stored on the quote, and does not invent or repeat one", () => {
    expect(quoteMoney("600", "USD")).toBe("600 USD");
    expect(quoteMoney(600, "usd")).toBe("600 USD");
    expect(quoteMoney("45 EUR", "EUR")).toBe("45 EUR");
    expect(quoteMoney("80 €", "EUR")).toBe("80 €");
    expect(quoteMoney("25 per hour", "XOF")).toBe("25 per hour XOF");
    expect(quoteMoney("600", "")).toBe("600");
    expect(quoteMoney("600", "US")).toBe("600");
    expect(requestFallbackText("quote", { title: "Audit", amount: "600", currency: "USD" })).toContain('Quote "Audit": 600 USD.');
    expect(requestFallbackText("quote", { title: "Catering", amount: "45 EUR", currency: "EUR" })).toContain('Quote "Catering": 45 EUR.');
    expect(requestCardLinesFr("quote", { title: "Audit", amount: "600", currency: "USD", items: [{ label: "Review", amount: "200" }] })).toEqual([
      "Audit",
      "Montant : 600 USD",
      "Review : 200 USD",
    ]);
  });

  it("rejects invalid MCP inputs", () => {
    const inputs = requestToolInputs(z) as Record<string, Record<string, z.ZodTypeAny>>;
    const create = z.object(inputs.request_create!);
    expect(() => create.parse({ type: "slot", toBotId: "not-a-uuid", slot: { when: "Friday" } })).toThrow();
    expect(() =>
      z.object(inputs.request_answer!).parse({ requestId: "00000000-0000-4000-8000-000000000001", answer: "hack" }),
    ).toThrow();
  });
});
