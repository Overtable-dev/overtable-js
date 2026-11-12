# Changelog of @overtable/sdk

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/); before 1.0.0, a minor version may break the API.

## 0.1.0 (unreleased)

First publication on npm.

### Added

- `OvertablePartner`: consent (OAuth 2.0 code with PKCE), a user's door, exchanges and mandate, the partner's links, deliveries, webhook and audit.
- Webhooks: `parseWebhook`, `verifyWebhook`, `assertWebhook`, `SeenDeliveries`.
- Receipts: `checkReceipt`, `relayKeys`, and the offline `verifyReceipt`, now from `@overtable/verify` (same API).
