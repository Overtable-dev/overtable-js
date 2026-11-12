# @overtable/verify

Check Overtable's signed receipts offline: no network, no database, no dependency beyond Node's own crypto. The same steps and failure codes as the relay's own verifier: the format, `receiptHash` against the canonical payload, the Ed25519 signature, then the subject's shape.

```sh
npm install @overtable/verify
```

Node 20 or later. ES modules, types included. The command works without installing: `npx @overtable/verify <receipt.json>`.

## Quickstart

The package ships two example receipts, an agreement and the decision it cites, signed by a throwaway example key (not Overtable's).

<!-- quickstart -->
```sh
cd node_modules/@overtable/verify/examples
npx overtable-verify receipt.json decision.json --public-key "$(cat public-key.txt)"
```

<!-- quickstart -->
```js
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { verifyReceipt } from "@overtable/verify";

const examples = createRequire(import.meta.url).resolve("@overtable/verify/package.json").replace(/package\.json$/, "examples/");
const receipt = readFileSync(examples + "receipt.json", "utf8");
console.log(verifyReceipt(receipt)); // { ok: true }

const tampered = JSON.parse(receipt);
tampered.payload.subject.fields.when = "2026-11-13T10:00:00.000Z";
console.log(verifyReceipt(tampered)); // { ok: false, code: "bad_hash", ... }
```

## Whose signature

Without keys, `verifyReceipt` checks the receipt against the key it embeds: it proves the receipt was not changed after signing, not who signed it. To prove Overtable signed it, pass the relay's keys, published at `https://app.overtable.dev/.well-known/audit-signing.json`:

```js
const { keys } = await (await fetch("https://app.overtable.dev/.well-known/audit-signing.json")).json();
verifyReceipt(receipt, { trustedKeys: keys });
```

On the command line, `--public-key <key>` does the same with one key (Ed25519 SPKI, DER, base64url). An offline check cannot know whether a receipt was revoked: `GET https://app.overtable.dev/v1/receipts/<verify token>/verify` gives the relay's own verdict.

## API

| Function | What it checks |
| --- | --- |
| `verifyReceipt(receipt, { trustedKeys? })` | One receipt, as an object or its JSON text. `{ ok }`, or `{ ok: false, code, message }` with `code` one of `bad_format`, `bad_hash`, `bad_signature`, `bad_key`, `bad_alg`, `bad_payload`. |
| `verifyReceiptBundle(receipts, { trustedKeys? })` | Several receipts: each one, then every decision an agreement cites, by id and hash. Returns the lines the command prints. |
| `verifyReceiptExport(json, { trustedKeys? })` | An owner's export (`overtable-receipt-export-v1`): every receipt, each trace against its receipt, each thread's chain. |
| `canonicalJson`, `receiptHashOf`, `parseReceipt` | The pieces: canonical JSON (keys sorted), the SHA-256 of a payload, the shape of a receipt. |

## Command

```text
overtable-verify <receipt.json> [more.json ...] [--public-key <spki-base64url>]
overtable-verify <overtable-receipts-export.json>
```

Exit codes: `0` every receipt verified, `1` a receipt failed, `2` wrong use or a file that cannot be read.

## Licence

See [LICENSE](./LICENSE).
