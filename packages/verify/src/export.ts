import { parseReceipt, verifyReceipt, type SignedReceipt, type VerifyReceiptOptions } from "./receipts.js";

/**
 * The owner's export of receipts (`overtable-receipt-export-v1`, /app/receipts/export.json), checked
 * offline as the relay checks it (packages/relay/src/receipts/export.ts, verifyReceiptExport): every
 * receipt's hash and signature, each trace's receipt step against the receipt it ends with, and each
 * thread's chain (each receipt names the hash of the one before), so a receipt taken out of the
 * middle of a thread shows. Only the receipts are signed; the traces and disputes beside them are the
 * relay's record.
 */
export const RECEIPT_EXPORT_FORMAT = "overtable-receipt-export-v1";

export type ReceiptExportCode = "bad_json" | "bad_format" | "bad_receipt" | "trace_mismatch" | "broken_chain";

export interface ReceiptExportCheck {
  ok: boolean;
  /** The first problem found, when not ok. */
  code?: ReceiptExportCode;
  receipts: Array<{ id: string; ok: boolean; code?: string }>;
}

interface ExportEntry {
  thread?: unknown;
  receipt?: unknown;
  trace?: Array<{ step?: unknown; data?: { receipt_id?: unknown; hash?: unknown } }> | null;
}

/** Checks an export, given as its JSON text or as the parsed object. */
export function verifyReceiptExport(input: string | unknown, options: VerifyReceiptOptions = {}): ReceiptExportCheck {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      return { ok: false, code: "bad_json", receipts: [] };
    }
  }
  const doc = parsed as { format?: unknown; receipts?: unknown } | null;
  if (!doc || typeof doc !== "object" || doc.format !== RECEIPT_EXPORT_FORMAT || !Array.isArray(doc.receipts)) {
    return { ok: false, code: "bad_format", receipts: [] };
  }
  const results: ReceiptExportCheck["receipts"] = [];
  let code: ReceiptExportCode | undefined;
  const byThread = new Map<string, SignedReceipt[]>();
  (doc.receipts as Array<ExportEntry | null>).forEach((entry, i) => {
    const raw = entry?.receipt;
    const signed = parseReceipt(raw);
    const id = signed?.payload.id ?? `#${i + 1}`;
    const check = verifyReceipt(typeof raw === "string" ? null : raw, options);
    if (!check.ok || !signed) {
      results.push({ id, ok: false, code: check.code ?? "bad_receipt" });
      code ??= "bad_receipt";
      return;
    }
    const step = (entry?.trace ?? []).find((s) => s?.step === "receipt");
    if (step && (step.data?.receipt_id !== id || step.data?.hash !== signed.receiptHash)) {
      results.push({ id, ok: false, code: "trace_mismatch" });
      code ??= "trace_mismatch";
      return;
    }
    results.push({ id, ok: true });
    const thread = typeof entry?.thread === "string" ? entry.thread : `#${i}`;
    byThread.set(thread, [...(byThread.get(thread) ?? []), signed]);
  });
  for (const chain of byThread.values()) {
    chain.sort((a, b) => a.payload.createdAt.localeCompare(b.payload.createdAt));
    for (let i = 1; i < chain.length; i += 1) {
      if (chain[i]!.payload.prevReceiptHash !== chain[i - 1]!.receiptHash) {
        code ??= "broken_chain";
      }
    }
  }
  return code ? { ok: false, code, receipts: results } : { ok: true, receipts: results };
}
