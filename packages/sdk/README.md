# @overtable/sdk

TypeScript SDK for Overtable's partner API: ask a user's consent, act for them within it, receive Overtable's webhooks, and check receipts.

```sh
npm install @overtable/sdk
```

Node 20 or later. ES modules, types included. One dependency: [`@overtable/verify`](https://www.npmjs.com/package/@overtable/verify), the offline receipt check.

## Quickstart

No partner account needed for this part: read the keys that sign the relay's receipts, and check a webhook the way your server will. `OVERTABLE_URL` defaults to `https://app.overtable.dev`.

<!-- quickstart -->
```js
import { OvertablePartner, signWebhook, verifyWebhook } from "@overtable/sdk";

const partner = new OvertablePartner({ baseUrl: process.env.OVERTABLE_URL ?? "https://app.overtable.dev" });
const keys = await partner.relayKeys();
console.log("receipt keys:", keys.map((k) => `${k.kid} (${k.alg})`).join(", "));

// A webhook as the relay signs it (Standard Webhooks), checked on the raw body.
const secret = "whsec_" + Buffer.from("a test secret of 32 bytes or so!").toString("base64");
const body = JSON.stringify({ type: "exchange_asked", data: {} });
const id = "msg_1";
const timestamp = String(Math.floor(Date.now() / 1000));
const headers = { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signWebhook(secret, id, timestamp, body) };
console.log("webhook verified:", verifyWebhook(secret, headers, body));
```

## With a partner account

The example below builds a vertical on the partner API.

```ts
import { OvertablePartner, parseWebhook, verifyReceipt } from "@overtable/sdk";

const partner = new OvertablePartner({ baseUrl: "https://app.overtable.dev", clientId, clientSecret, apiKey });
const consent = partner.authorize({ redirectUri, scopes: ["door:manage", "exchanges:read", "exchanges:answer"] });
// ... the user confirms on Overtable, you get the code back
const tokens = await partner.exchangeCode({ code, redirectUri, codeVerifier: consent.codeVerifier });
const user = partner.user({ tokens, onRefresh: save });
await user.setDoor({ trade: "creator" });
```

What it covers:

- **Consent**: `authorize`, `parseCallback`, `exchangeCode`, `refresh` (OAuth 2.0 code with PKCE S256; the refresh token rotates).
- **For one user** (`partner.user(tokens)`): `me`, `door`, `setDoor`, `exchanges`, `exchange`, `answer`, `refuse`, `mandate`, `tighten`, `unlink`.
- **The partner's own** (API key): `account`, `links`, `deliveries`, `replayDelivery`, `setWebhook`, `audit`, `doorPairs`, `askDoor` and `fanExchanges` (a fan's question relayed to a linked door), `reportDecision`.
- **Webhooks**: `parseWebhook`, `verifyWebhook`, `assertWebhook` (Standard Webhooks, as the relay signs them: `v1,` HMAC-SHA256 of `id.timestamp.body`, 5 minutes either way, two secrets during a rotation), `SeenDeliveries` to drop retries.
- **Receipts**: `checkReceipt` (the relay's public check by verify token, as `/verify`), `relayKeys`, and `verifyReceipt` offline (format, hash of the canonical payload, Ed25519 signature, subject shape: the same steps and codes as `overtable-receipt-verify`).

What it does not do: decide anything. The user's rules, their confirmations and the receipts stay on the relay. At run time it needs Node 20 (`node:crypto`, `fetch`) and `@overtable/verify`; the types of pairs and answers are included.

## Licence

See [LICENSE](./LICENSE).
