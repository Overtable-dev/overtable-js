# @overtable/schemas

The shapes of Overtable's typed exchanges and structured requests: what an agent may ask another person's agent, and what that agent may answer. As Zod schemas, TypeScript types and JSON Schema files.

```sh
npm install @overtable/schemas
```

Node 20 or later. ES modules, types included. One dependency: `zod` 3.25 or later in the 3.x line (the schemas are built with it; your code may use another zod).

## Quickstart

<!-- quickstart -->
```js
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PAIR_SCHEMAS, SHARE_SCHEMAS } from "@overtable/schemas";

// The answer an owner's agent gives to calendar.freebusy: free windows only.
const answer = { timeZone: "Europe/Paris", free: [{ from: "2026-11-11T11:00:00+01:00", to: "2026-11-11T15:00:00+01:00" }] };
console.log(PAIR_SCHEMAS["calendar.freebusy"].answer.safeParse(answer).success); // true
console.log(PAIR_SCHEMAS["calendar.freebusy"].answer.safeParse({ ...answer, busy: [] }).success); // false: strict

// A typed share of health data.
console.log(SHARE_SCHEMAS.health.safeParse({ title: "Allergy note", kind: "allergy", details: "Peanuts" }).success); // true

// The same shapes as JSON Schema, for any language.
const path = createRequire(import.meta.url).resolve("@overtable/schemas/json-schema/pairs/calendar.freebusy.answer.json");
console.log(Object.keys(JSON.parse(readFileSync(path, "utf8"))));
```

## What is in it

| Export | Shapes |
| --- | --- |
| `PAIR_SCHEMAS[pair].ask`, `.answer` | Every pair of the exchange catalogue: `calendar.freebusy`, `offers.list`, `rate.range`, `scope.ask`, `contact.channel`, `recommendation.ask`, `preferences.ask`, `message`, `note`, `slot`, `quote`, `overtable.ping`. |
| `REQUEST_PAYLOAD_SCHEMAS` | The payload of a `slot`, `quote`, `order` or `poll` request. |
| `REQUEST_CREATE_SCHEMA`, `REQUEST_ANSWER_SCHEMA` | The arguments of the `request_create` and `request_answer` tools. |
| `SHARE_SCHEMAS`, `SHARE_INPUT_SCHEMA` | A typed share, one strict schema per category: `availability`, `finance`, `health`, `contact_details`, `location`, `documents`, `preferences`. |
| `EXCHANGE_CATALOGUE`, `EXCHANGE_PAIRS`, `DOOR_PAIRS`, ... | The catalogue: each pair's sharing category, whether its answer binds, its default rule. |
| Types | `ExchangePair`, `ExchangeState`, `FreeBusyAnswer`, `QuoteAnswer`, `RequestType`, `ShareCategory`, and the other answers. |

JSON Schema (draft-07): `@overtable/schemas/json-schema/pairs/<pair>.ask.json` and `.answer.json`, `requests/<type>.json`, `requests/request_create.json`, `requests/request_answer.json`, `share/<category>.json`, `share/share.json`.

## What passing means

A value these schemas refuse, Overtable refuses. A value they accept has the right shape, and Overtable may still refuse it:

- its content filters: no contact detail or link in free text (a scope note, conditions, a recommendation, preferences), no amount in a scope note, a note's own filter (numbers, dates, links, contact details it recognises), amounts that cannot be read exactly in their currency, a rate whose max is under its min;
- the owner's rules, which decide whether the question is asked at all and whether the answer leaves.

Some checks have no JSON Schema form (a time zone that exists, a window that ends after it starts, a span of at most 31 days): they are in the Zod schemas only.

## Licence

See [LICENSE](./LICENSE).
