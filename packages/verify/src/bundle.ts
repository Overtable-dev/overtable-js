import { parseReceipt, verifyReceipt, AGREEMENT_AUTHORITY_VERSION, type SignedReceipt, type VerifyReceiptOptions } from "./receipts.js";

/**
 * Several receipts at once, as `overtable-receipt-verify` checks them: each one alone, then every decision an agreement cites, when that decision
 * receipt is among them, by id and receiptHash. A cited decision that is absent is reported, not
 * failed: a party may hold the agreement without the other's decisions. The lines are the relay's.
 */
export interface ReceiptBundleResult {
  ok: boolean;
  /** One line per receipt, then one per cited decision: `OK ...`, `FAIL ...` or `NOTE ...`. */
  lines: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** ", accepted by <method>" for an authority that signs how the owner said yes; nothing otherwise. */
function ownerMethod(authority: unknown): string {
  return isRecord(authority) && authority.version === AGREEMENT_AUTHORITY_VERSION ? `, accepted by ${String(authority.method)}` : "";
}

export function verifyReceiptBundle(raws: readonly unknown[], options: VerifyReceiptOptions = {}): ReceiptBundleResult {
  const lines: string[] = [];
  let ok = true;
  const byId = new Map<string, SignedReceipt>();
  raws.forEach((raw, i) => {
    // A JSON string inside the bundle is not a receipt (verifyReceipt alone would parse it as text).
    const check = verifyReceipt(typeof raw === "string" ? null : raw, options);
    const signed = parseReceipt(raw);
    const label = signed ? `${signed.payload.id} (${String(signed.payload.subject.kind)})` : `#${i + 1}`;
    if (!check.ok || !signed) {
      ok = false;
      lines.push(`FAIL ${label}: ${check.code ?? "error"}: ${check.message ?? "invalid"}`);
      return;
    }
    byId.set(signed.payload.id, signed);
    const subject = signed.payload.subject;
    lines.push(
      subject.kind === "decision"
        ? `OK ${label}: ${String(subject.decision)} ${String(subject.actionType)} by ${String(subject.method)}, digest ${String(subject.contentHash)}`
        : `OK ${label}: content ${String(subject.contentHash)}${ownerMethod(signed.payload.authority)}`,
    );
  });
  for (const signed of byId.values()) {
    for (const ref of signed.payload.decisions ?? []) {
      const cited = byId.get(ref.id);
      if (!cited) {
        lines.push(`NOTE ${signed.payload.id} cites ${ref.id}, not given.`);
      } else if (cited.payload.subject.kind !== "decision" || cited.receiptHash !== ref.receiptHash) {
        ok = false;
        lines.push(`FAIL ${signed.payload.id} cites ${ref.id} with another hash.`);
      } else {
        lines.push(`OK ${signed.payload.id} cites ${ref.id}.`);
      }
    }
  }
  return { ok, lines };
}
