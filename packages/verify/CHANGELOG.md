# Changelog of @overtable/verify

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/); before 1.0.0, a minor version may break the API.

## 0.1.0 (2026-11-14)

First publication on npm.

### Added

- `verifyReceipt`, `verifyReceiptBundle`, `verifyReceiptExport`: the relay's receipt checks, offline, with the same failure codes.
- `overtable-verify`: the same arguments, lines and exit codes as the relay's `overtable-receipt-verify`.
- Example receipts in `examples/`, signed by a throwaway key.
