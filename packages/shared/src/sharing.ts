/**
 * Sharing categories and the rules a human sets for them. The sending bot declares the
 * category; the relay never reads the text. free_text is the safety net: a message without
 * a category counts as free_text, and a sensitive contact gets no free_text without the
 * human's OK.
 */
export const SHARING_CATEGORIES = [
  "free_text",
  "availability",
  "recommendations",
  "preferences",
  "location",
  "contact_details",
  "documents",
  "finance",
  "health",
  "votes",
  "commit",
] as const;
export type SharingCategory = (typeof SHARING_CATEGORIES)[number];

/** How a category reads on a page or in an email to the human. */
export const SHARING_CATEGORY_LABELS: Record<SharingCategory, string> = {
  free_text: "free text",
  availability: "availability",
  recommendations: "recommendations",
  preferences: "preferences",
  location: "location",
  contact_details: "contact details",
  documents: "documents",
  finance: "finance",
  health: "health",
  votes: "votes",
  commit: "commitment",
};

/**
 * A commitment in the human's name: a booking, a payment, accepting a date. Always held for the
 * human's yes (a confirmation less than 10 minutes old), whatever the rules say, so no rule can be set for it.
 */
export const COMMIT_CATEGORY = "commit" satisfies SharingCategory;

/** The categories a human sets rules for: every one but commit. */
export const RULE_CATEGORIES = SHARING_CATEGORIES.filter((c) => c !== COMMIT_CATEGORY);

/** allow: delivered. ask: held until the human approves this one message. deny: refused. */
export const SHARING_DECISIONS = ["allow", "ask", "deny"] as const;
export type SharingDecision = (typeof SHARING_DECISIONS)[number];

export const CATEGORY_DESCRIPTIONS: Record<SharingCategory, string> = {
  free_text: "Anything without a more specific category. Used when a message names no category.",
  availability: "When the human is free or busy: dates, times, schedules.",
  recommendations: "Places, products or people the human recommends.",
  preferences: "What the human likes or prefers: food, style, habits.",
  location: "Where the human is, lives or will be: addresses, places, coordinates.",
  contact_details: "Phone numbers, email or postal addresses, handles, of the human or of anyone else.",
  documents: "Files and attachments. A documents rule you set also applies to every message that carries images.",
  finance: "Money: amounts, bank or card details, income, purchases.",
  health: "Health, medical or care information.",
  votes: "The human's votes in a room plan: which option they prefer, and their constraints.",
  commit: "A commitment in your human's name: a booking, a payment, accepting a date. Always waits for your human's yes on Overtable, whatever the rules.",
};

/**
 * Applies when the human set no rule. Bots share freely with their contacts: the human tightens
 * a category for everyone or for one contact. Location and contact details wait for the human
 * unless the contact is a trusted person (the Trusted preset writes their own rows) or the human
 * set a rule (#341). Money, health, plan votes and commitments still wait for the human.
 */
export const BUILTIN_SHARING: Record<SharingCategory, SharingDecision> = {
  free_text: "allow",
  availability: "allow",
  recommendations: "allow",
  preferences: "allow",
  location: "ask",
  contact_details: "ask",
  documents: "allow",
  finance: "ask",
  health: "ask",
  votes: "ask",
  commit: "ask",
};

export type SharingRules = Partial<Record<SharingCategory, SharingDecision>>;

/** The rules of one sender for one recipient. */
export interface SharingRuleSet {
  /** The sender's rules for every recipient. */
  defaults: SharingRules;
  /** The sender's rules for this recipient; they win over the defaults. */
  peer: SharingRules;
  /** A sensitive recipient gets no free_text without the human's OK. */
  sensitive: boolean;
  /**
   * The categories the sender's human never shares (their mandate's never-share, #353): denied
   * for every recipient, whatever the peer row, the row for everyone, a grant or a preset says.
   */
  never?: readonly SharingCategory[];
}

const STRICTNESS: Record<SharingDecision, number> = { allow: 0, ask: 1, deny: 2 };

/** Never-share first, then the peer rule, else default rule, else the built-in default. Sensitive turns a free_text allow into ask. */
export function resolveSharing(rules: SharingRuleSet, category: SharingCategory): SharingDecision {
  if (rules.never?.includes(category)) {
    return "deny";
  }
  if (category === COMMIT_CATEGORY) {
    return "ask";
  }
  const decision = rules.peer[category] ?? rules.defaults[category] ?? BUILTIN_SHARING[category];
  if (category === "free_text" && rules.sensitive && decision === "allow") {
    return "ask";
  }
  return decision;
}

/**
 * The decision for one message, and the category that set it. Images travel under the
 * message's category. When the human set a documents rule (for this recipient or for all),
 * a message with images must also pass it; without such a rule, images in a free_text
 * message pass as they did before categories existed.
 */
export function decideSharing(
  rules: SharingRuleSet,
  category: SharingCategory,
  imageCount: number,
): { decision: SharingDecision; category: SharingCategory } {
  const decision = resolveSharing(rules, category);
  if (category === COMMIT_CATEGORY) {
    return { decision, category };
  }
  const documents = rules.never?.includes("documents") ? "deny" : (rules.peer.documents ?? rules.defaults.documents);
  if (imageCount > 0 && documents !== undefined && STRICTNESS[documents] > STRICTNESS[decision]) {
    return { decision: documents, category: "documents" };
  }
  return { decision, category };
}

/** Every category with its effective decision. */
export function effectiveSharing(rules: SharingRuleSet): Record<SharingCategory, SharingDecision> {
  return Object.fromEntries(SHARING_CATEGORIES.map((c) => [c, resolveSharing(rules, c)])) as Record<
    SharingCategory,
    SharingDecision
  >;
}

/**
 * True when `after` lets through anything `before` held or refused: some category, with or
 * without images, gets a less strict decision. Tightening applies at once; a loosening
 * waits for the human's confirmation by email.
 */
export function sharingLoosens(before: SharingRuleSet, after: SharingRuleSet): boolean {
  return SHARING_CATEGORIES.some((category) =>
    [0, 1].some(
      (images) =>
        STRICTNESS[decideSharing(after, category, images).decision] <
        STRICTNESS[decideSharing(before, category, images).decision],
    ),
  );
}
