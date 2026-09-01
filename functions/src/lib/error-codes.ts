/**
 * The stable names for the errors a participant branches on.
 *
 * Every error here already carries a sentence, and the sentences are mostly
 * good. They are also the only thing a caller can key off, which makes a copy
 * edit a breaking change nobody notices: a bot deciding whether to retry by
 * matching "Market is closed" breaks the day someone improves that wording.
 * The audience is machines, so the machine-readable half was missing.
 *
 * Rules, both of which the tests enforce:
 *
 * - ADDITIVE. `error` keeps its exact wording; `code` appears beside it. Adding
 *   a field breaks no existing client.
 * - A code is a PROMISE. Once published it cannot be repurposed or removed,
 *   because somewhere a bot is branching on it. Adding one is cheap; changing
 *   one is not. Every member must appear in the api-reference guide before the
 *   suite passes, so the vocabulary cannot grow undocumented.
 *
 * Coverage is partial on purpose: the errors a participant acts on are coded,
 * the rest are not yet. An absent `code` means "not coded yet", never "this
 * cannot happen", and callers must treat it that way.
 */

export const ERROR_CODES = [
  /** The caller's balance will not cover the trade or the order it reserves. */
  'insufficient_balance',
  /** Selling more shares than the position holds. */
  'insufficient_shares',
  /** Priced out at zero: the budget cannot buy a share at this curve. */
  'trade_too_small',
  /** No such market in this workspace. */
  'market_not_found',
  /** Settled. Nothing trades, in either direction, ever again. */
  'market_resolved',
  /** Cancelled and refunded. Nothing trades. */
  'market_voided',
  /** Deactivated by the time preference: sells only. Retryable as a sell. */
  'market_closed',
  'market_settling',
  'workspace_not_public',
  /** An Idempotency-Key already used for a DIFFERENT request body. */
  'idempotency_key_reuse',
  /** The action needs a participant, and the caller is anonymous. */
  'identity_required',
  /**
   * The identity is real but its permission groups do not grant the capability
   * this action needs. Distinct from identity_required: registering does not
   * fix this one, being added to a group does. `requiredCapabilities` says
   * which.
   */
  'not_authorized',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Where the codes are documented, one anchor for the table. */
const DOC_BASE = 'https://telarchy.com/guides/api-reference#error-codes';

/**
 * The documentation link that travels with a code.
 *
 * One anchor rather than one page per code: the table is short enough to read
 * whole, and a link per code is a maintenance surface with no reader benefit.
 */
export function docUrlFor(_code: ErrorCode): string {
  return DOC_BASE;
}
