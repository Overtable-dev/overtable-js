/**
 * @overtable/verify: check Overtable's signed receipts offline (docs/protocol/receipts.md). No
 * network, no database, no dependency beyond Node's own crypto. The same steps and failure codes
 * as the relay's verifier and its `overtable-receipt-verify` command.
 */
export {
  verifyReceipt,
  parseReceipt,
  receiptHashOf,
  receiptPayloadProblem,
  canonicalJson,
  RECEIPT_FORMAT,
  RECEIPT_SIGNING_ALG,
  AGREEMENT_AUTHORITY_VERSION,
  VERIFY_TOKEN,
  type SignedReceipt,
  type ReceiptSignature,
  type ReceiptCheck,
  type ReceiptFailure,
  type RelayPublicKey,
  type VerifyReceiptOptions,
} from "./receipts.js";
export { verifyReceiptBundle, type ReceiptBundleResult } from "./bundle.js";
export { verifyReceiptExport, RECEIPT_EXPORT_FORMAT, type ReceiptExportCheck, type ReceiptExportCode } from "./export.js";
export { runVerifyCli, type VerifyCliIo } from "./cli.js";
