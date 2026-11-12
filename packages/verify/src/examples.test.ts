import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runVerifyCli, verifyReceipt, verifyReceiptBundle } from "./index.js";

// The examples the package ships (examples/, made by scripts/publish/make-verify-examples.ts), checked with the
// package alone: no relay. These tests also run in the public repository of the packages, where the tests
// against the relay's own signer (receipts.test.ts, bundle-export.test.ts) are not copied.
const examples = new URL("../examples/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, examples), "utf8");
const receipt = read("receipt.json");
const decision = read("decision.json");
const publicKey = read("public-key.txt").trim();

function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runVerifyCli(argv, { stdout: (t) => out.push(t), stderr: (t) => err.push(t), readFile: (path) => read(path) });
  return { code, out: out.join(""), err: err.join("") };
}

describe("the shipped examples", () => {
  it("verify against the key they embed and against the example public key", () => {
    expect(verifyReceipt(receipt)).toEqual({ ok: true });
    expect(verifyReceipt(decision)).toEqual({ ok: true });
    const kid = (JSON.parse(receipt) as { signature: { kid: string } }).signature.kid;
    expect(verifyReceipt(receipt, { trustedKeys: [{ kid, alg: "Ed25519", publicKey }] })).toEqual({ ok: true });
  });

  it("fail with bad_hash once a signed field changes", () => {
    const tampered = JSON.parse(receipt) as { payload: { subject: { fields: Record<string, unknown> } } };
    tampered.payload.subject.fields.when = "changed";
    expect(verifyReceipt(tampered)).toMatchObject({ ok: false, code: "bad_hash" });
  });

  it("verify together: the agreement and the decision it cites", () => {
    const result = verifyReceiptBundle([JSON.parse(receipt), JSON.parse(decision)]);
    expect(result.ok).toBe(true);
    expect(result.lines.some((l) => l.startsWith("FAIL"))).toBe(false);
  });

  it("pass the command with the example key, and fail it with another key", () => {
    const ok = cli(["receipt.json", "decision.json", "--public-key", publicKey]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("OK: every receipt verified.");
    const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    expect(cli(["receipt.json", "--public-key", other]).code).toBe(1);
    expect(cli([]).code).toBe(2);
  });
});
