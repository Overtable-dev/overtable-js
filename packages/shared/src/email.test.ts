import { describe, expect, it } from "vitest";
import {
  emailDomainAllowed,
  emailMailbox,
  maskEmailAddress,
  normalizeEmailAddress,
  normalizeEmailDomain,
} from "./email.js";
import { wakeEmailSchema } from "./schemas.js";

describe("normalizeEmailAddress", () => {
  it("accepts plain addresses, tags included, and lowercases the domain", () => {
    expect(normalizeEmailAddress("awa+overtable@Example.COM")).toBe("awa+overtable@example.com");
    expect(normalizeEmailAddress("  first.last_1-x@mail.sub.example.org ")).toBe(
      "first.last_1-x@mail.sub.example.org",
    );
    expect(normalizeEmailAddress(`${"a".repeat(64)}@example.com`)).not.toBeNull();
  });

  it("refuses anything a mailer could read as a display name or a second recipient", () => {
    for (const bad of [
      "",
      "awa",
      "awa@",
      "@example.com",
      "awa@example",
      "awa@@example.com",
      "awa@b@example.com",
      "a@x.com,b@y.com",
      "a@x.com;b@y.com",
      "Awa <awa@example.com>",
      "\"awa\"@example.com",
      "awa @example.com",
      "awa@example.com\r\nBcc: x@y.com",
      "awa@example.com\n",
      ".awa@example.com",
      "awa.@example.com",
      "a..wa@example.com",
      "awa@-example.com",
      "awa@example-.com",
      "awa@example..com",
      "awa@[127.0.0.1]",
      "awa@127.0.0.1",
      "awa@example.c",
      "awa@example.123",
      "awà@example.com",
      "awa@exämple.com",
      `${"a".repeat(65)}@example.com`,
      `a@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.${"e".repeat(63)}.com`,
    ]) {
      expect(normalizeEmailAddress(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("emailMailbox", () => {
  it("drops the tag and folds case, so variants of one mailbox compare equal", () => {
    expect(emailMailbox("Wake+Overtable@Relay.Example")).toBe("wake@relay.example");
    expect(emailMailbox("wake@relay.example")).toBe("wake@relay.example");
    expect(emailMailbox("a+b+c@x.io")).toBe("a@x.io");
  });
});

describe("maskEmailAddress", () => {
  it("keeps the first character and the domain only", () => {
    expect(maskEmailAddress("awa+overtable@Mail.Example.com")).toBe("a***@mail.example.com");
    expect(maskEmailAddress("b@x.io")).toBe("b***@x.io");
    expect(maskEmailAddress("not-an-address")).toBe("***");
  });
});

describe("normalizeEmailDomain", () => {
  it("lowercases host names and refuses wildcards, addresses and IP literals", () => {
    expect(normalizeEmailDomain("Mail.Example.com")).toBe("mail.example.com");
    for (const bad of ["", "localhost", "*.example.com", "a@example.com", "10.0.0.1", "example.com.", "-x.com"]) {
      expect(normalizeEmailDomain(bad), bad).toBeNull();
    }
  });
});

describe("emailDomainAllowed", () => {
  const allowed = ["mail.example.com", "example.org"];

  it("matches the domain after the last @ exactly, ignoring case", () => {
    expect(emailDomainAllowed("bot+overtable@mail.example.com", allowed)).toBe(true);
    expect(emailDomainAllowed("Bot@MAIL.Example.COM", allowed)).toBe(true);
    expect(emailDomainAllowed("x@example.org", allowed)).toBe(true);
  });

  it("refuses subdomains, parent domains and look-alikes", () => {
    for (const address of [
      "x@sub.mail.example.com",
      "x@example.com",
      "x@mail.example.com.evil.test",
      "x@evilmail.example.com",
      "x@other.test",
    ]) {
      expect(emailDomainAllowed(address, allowed), address).toBe(false);
    }
  });

  it("allows every domain without a list, and none with an empty one", () => {
    expect(emailDomainAllowed("x@anything.test", null)).toBe(true);
    expect(emailDomainAllowed("x@anything.test", [])).toBe(false);
  });
});

describe("wakeEmailSchema", () => {
  it("returns the normalized address and a message that does not echo the input", () => {
    expect(wakeEmailSchema.parse({ address: "awa+overtable@X.ai" })).toEqual({ address: "awa+overtable@x.ai" });
    const result = wakeEmailSchema.safeParse({ address: "secret-looking-value" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.errors)).not.toContain("secret-looking-value");
    expect(wakeEmailSchema.safeParse({}).success).toBe(false);
  });
});
