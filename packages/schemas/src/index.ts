/**
 * @overtable/schemas: the public shapes of Overtable's typed exchanges (docs/protocol/exchanges.md)
 * and structured requests (docs/requests.md), as Zod schemas and TypeScript types. The same shapes
 * as JSON Schema files: `@overtable/schemas/json-schema/<path>.json`.
 */
export { PAIR_SCHEMAS, pairSchema, type PairSchema, MAX_FREEBUSY_DAYS, MAX_NEED, MAX_MESSAGE, MAX_SLOT_TIMES, MAX_QUOTE_QUANTITY, MAX_RECOMMENDATION, MAX_PREFERENCES } from "./pairs.js";
export { REQUEST_PAYLOAD_SCHEMAS, SHARE_SCHEMAS, SHARE_INPUT_SCHEMA, REQUEST_CREATE_SCHEMA, REQUEST_ANSWER_SCHEMA } from "./requests.js";
export {
  EXCHANGE_PAIRS,
  ASKABLE_EXCHANGE_PAIRS,
  DOOR_PAIRS,
  EXCHANGE_CATALOGUE,
  RATE_UNITS,
  QUOTE_UNITS,
  MAX_NOTE_LENGTH,
  REQUEST_TYPES,
  REQUEST_CREATE_TYPES,
  REQUEST_ANSWERS,
  SHARE_CATEGORIES,
  SHARE_TITLE_MAX,
  FINANCE_KINDS,
  HEALTH_KINDS,
  HEALTH_SEVERITIES,
  SHARING_CATEGORIES,
  type ExchangePair,
  type AskableExchangePair,
  type ExchangePairSpec,
  type ExchangeState,
  type ExchangeAudience,
  type DoorNeed,
  type FreeBusyAnswer,
  type OffersListAnswer,
  type RateRangeAnswer,
  type ScopeAskAnswer,
  type RecommendationAnswer,
  type PreferencesAnswer,
  type ContactChannelAnswer,
  type QuoteAnswer,
  type QuoteRequest,
  type QuoteAcceptance,
  type QuoteAsk,
  type RequestType,
  type RequestKind,
  type RequestAnswerKind,
  type ShareCategory,
  type SharingCategory,
  type SharingDecision,
} from "@overtable/shared";
