/**
 * @overtable/sdk: build a vertical on Overtable's partner API (docs/partners.md,
 * docs/partners/quickstart.md). Prepared for npm (docs/publishing.md), not published yet.
 */
export {
  OvertablePartner,
  PartnerUser,
  OvertableApiError,
  ConsentError,
  type PartnerConfig,
  type AuthorizeOptions,
  type AuthorizeRequest,
  type CallbackResult,
  type UserSession,
} from "./client.js";
export {
  assertWebhook,
  verifyWebhook,
  parseWebhook,
  signWebhook,
  webhookHeaders,
  webhookKey,
  SeenDeliveries,
  WebhookVerificationError,
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  type PartnerEvent,
  type PartnerEventType,
  type ExchangeRef,
  type WebhookHeaders,
  type WebhookFailure,
  type VerifyWebhookOptions,
} from "./webhooks.js";
export {
  verifyReceipt,
  parseReceipt,
  receiptHashOf,
  receiptPayloadProblem,
  canonicalJson,
  RECEIPT_FORMAT,
  VERIFY_TOKEN,
  type SignedReceipt,
  type ReceiptCheck,
  type ReceiptFailure,
  type RelayPublicKey,
  type VerifyReceiptOptions,
} from "@overtable/verify";
export * from "./types.js";
