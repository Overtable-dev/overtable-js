import { describe, expect, it } from "vitest";
import { en } from "./catalog-en.js";
import { fr } from "./catalog-fr.js";
import { deName } from "./de-name.js";
import { catalogKeys, t } from "./t.js";
import { langFromAcceptLanguage, resolveLang } from "./resolve.js";

describe("i18n", () => {
  it("keeps the same keys in en and fr", () => {
    const enKeys = Object.keys(en).sort();
    const frKeys = Object.keys(fr).sort();
    expect(frKeys).toEqual(enKeys);
    expect(catalogKeys().length).toBeGreaterThan(50);
  });

  it("interpolates and falls back", () => {
    expect(t("sheet.forBot", "en", { name: "Awa" })).toContain("Awa");
    expect(t("auth.signinPasskey", "fr")).toBe("Entrer avec le visage ou l'empreinte");
    expect(t("notice.request_accepted", "fr")).toBe("Demande acceptée.");
    expect(t("push.title", "en")).toBe("An agreement waits for you");
  });

  it("resolves Accept-Language and preference order", () => {
    expect(langFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(langFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(langFromAcceptLanguage(undefined)).toBeNull();
    expect(resolveLang({ account: "fr", cookie: "en", acceptLanguage: "en" })).toBe("fr");
    expect(resolveLang({ cookie: "fr", acceptLanguage: "en" })).toBe("fr");
    expect(resolveLang({ acceptLanguage: "fr-CA" })).toBe("fr");
    expect(resolveLang({})).toBe("en");
  });

  it("elides French de before a vowel, accented or not, and keeps it before a consonant or an h", () => {
    for (const [name, written] of [
      ["Awa", "d'Awa"],
      ["Emily", "d'Emily"],
      ["Karim", "de Karim"],
      ["Élodie", "d'Élodie"],
      ["Ève", "d'Ève"],
      ["Île", "d'Île"],
      ["Œuvre", "d'Œuvre"],
      ["ousmane", "d'ousmane"],
      ["Yvan", "d'Yvan"],
      ["Hugo", "de Hugo"],
      ["Hélène", "de Hélène"],
      ["@awa", "de @awa"],
      ["", "de "],
    ]) {
      expect(deName(name!)).toBe(written);
    }
  });

  it("writes {de:name} through deName, and leaves the other placeholders as they are", () => {
    expect(t("wake.of", "fr", { bot: "AwaBot", human: "Awa" })).toBe("AwaBot d'Awa");
    expect(t("wake.of", "fr", { bot: "MalickBot", human: "Malick" })).toBe("MalickBot de Malick");
    expect(t("plan.event.rejected", "fr", { name: "Élodie" })).toBe("L'humain d'Élodie a refusé son vote");
    expect(t("publicChat.verifyBody", "fr", { name: "$&" })).toContain("la page de $&.");
    for (const key of catalogKeys()) {
      expect(fr[key], key).not.toMatch(/\bde \{/);
    }
  });

  it("avoids em dashes in catalogs", () => {
    for (const key of catalogKeys()) {
      expect(en[key], key).not.toMatch(/—/);
      expect(fr[key], key).not.toMatch(/—/);
    }
  });
});
