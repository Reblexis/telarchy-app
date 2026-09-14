/**
 * Where the price comes to rest after the resting orders a trade crosses
 * (docs/limit-orders.md, "A quote lands where the price comes to rest").
 *
 * The server runs the fill pass inside the trade's own transaction
 * (functions/src/services/trading.ts, fillLimitOrdersInTx) and the 12-second
 * sweep finishes whatever that pass's step bound left. A ticket that drew the
 * trade's move alone showed a price the book never rested at, so the ticket
 * runs the same pass here, on the open orders the prices read lists, with the
 * server's own LMSR arithmetic copied below (the app bundle cannot import
 * functions/). Pinned by src/lib/__tests__/limit-fills.test.ts (the rules and
 * every primitive against the server's) and by
 * functions/src/__tests__/landing-parity.test.ts (end to end, real trades).
 */

/** One open order on a book, as GET /api/marketplace/:id/prices lists it. */
export interface RestingOrder {
  id: string;
  side: 'buy' | 'sell';
  direction: 'higher' | 'lower';
  /** On the book's own scale, like consensus. */
  limitValue: number;
  /** What the order still has to do: credits on a buy, shares on a sell. */
  left: number;
  /** One participant within this book and answer; nobody is named. */
  holder: number;
  /** That participant's shares on each side of the book. */
  held: { higher: number; lower: number };
  expiresAt?: string | null;
}

const CREDIT_PRECISION = 1_000_000_000;
/** Below this many shares a sell has nothing left to sell (the server's SHARE_EPS). */
const SHARE_EPS = 1e-6;
/** Fills per pass before the server hands the rest to the next sweep. */
const PASS_STEPS = 50;
/** A backstop against a pathological loop, far past anything a real book does. */
const MAX_PASSES = 200;

function roundCredits(x: number): number {
  return Math.round(x * CREDIT_PRECISION) / CREDIT_PRECISION;
}

export function lmsrCost(shares: [number, number], b: number): number {
  const max = Math.max(shares[0], shares[1]);
  return b * (max / b + Math.log(Math.exp((shares[0] - max) / b) + Math.exp((shares[1] - max) / b)));
}

function pHigher(shares: [number, number], b: number): number {
  if (b <= 0) return 0;
  return 1 / (1 + Math.exp(-(shares[1] - shares[0]) / b));
}

function consensusOf(shares: [number, number], b: number, rangeMin: number, rangeMax: number): number {
  return Math.round((rangeMin + pHigher(shares, b) * (rangeMax - rangeMin)) * 100) / 100;
}

export function directionTradeCost(shares: [number, number], direction: 0 | 1, amount: number, b: number): number {
  const after: [number, number] = [shares[0], shares[1]];
  after[direction] += amount;
  return roundCredits(lmsrCost(after, b) - lmsrCost(shares, b));
}

export function sharesForBudget(
  shares: [number, number],
  direction: 0 | 1,
  budget: number,
  b: number,
): { amount: number; cost: number } {
  let lo = 0;
  let hi = budget * 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (directionTradeCost(shares, direction, mid, b) < budget) lo = mid;
    else hi = mid;
  }
  const amount = roundCredits(lo);
  return { amount, cost: directionTradeCost(shares, direction, amount, b) };
}

export function betTowardsValue(
  shares: [number, number],
  b: number,
  rangeMin: number,
  rangeMax: number,
  targetValue: number,
  maxBudget: number,
  forcedDirection?: 0 | 1,
): { direction: 0 | 1; amount: number; cost: number } {
  const current = b > 0 ? consensusOf(shares, b, rangeMin, rangeMax) : rangeMin + (rangeMax - rangeMin) / 2;
  if (Math.abs(targetValue - current) < 0.01) return { direction: forcedDirection ?? 1, amount: 0, cost: 0 };
  if (forcedDirection !== undefined) {
    const behind = forcedDirection === 1 ? targetValue <= current : targetValue >= current;
    if (behind) return { direction: forcedDirection, amount: 0, cost: 0 };
  }
  const direction: 0 | 1 = forcedDirection ?? (targetValue >= current ? 1 : 0);
  const p = (targetValue - rangeMin) / (rangeMax - rangeMin);
  if (p <= 0) return { direction: 0, ...sharesForBudget(shares, 0, maxBudget, b) };
  if (p >= 1) return { direction: 1, ...sharesForBudget(shares, 1, maxBudget, b) };
  const targetDiff = -b * Math.log(1 / p - 1);
  const currentDiff = shares[1] - shares[0];
  const needed = Math.max(0, direction === 1 ? targetDiff - currentDiff : currentDiff - targetDiff);
  if (directionTradeCost(shares, direction, needed, b) <= maxBudget) {
    const amount = roundCredits(needed);
    return { direction, amount, cost: directionTradeCost(shares, direction, amount, b) };
  }
  return { direction, ...sharesForBudget(shares, direction, maxBudget, b) };
}

export function directionSellProceeds(shares: [number, number], direction: 0 | 1, amount: number, b: number): number {
  const after: [number, number] = [shares[0], shares[1]];
  after[direction] -= amount;
  return roundCredits(lmsrCost(shares, b) - lmsrCost(after, b));
}

/** Shares a trade may move before the call passes `bound` (the server's sharesToBound). */
export function sharesToBound(
  book: [number, number],
  b: number,
  rangeMin: number,
  rangeMax: number,
  direction: 0 | 1,
  isSell: boolean,
  bound: number,
): number {
  // A buy of higher and a sell of lower push the call up, so their bound is a ceiling.
  const ceiling = (direction === 1) !== isSell;
  const p = (bound - rangeMin) / (rangeMax - rangeMin);
  if (ceiling) {
    if (p >= 1) return Number.POSITIVE_INFINITY;
    if (p <= 0) return 0;
  } else {
    if (p <= 0) return Number.POSITIVE_INFINITY;
    if (p >= 1) return 0;
  }
  const boundDiff = b * Math.log(p / (1 - p));
  const diff = book[1] - book[0];
  return Math.max(0, ceiling ? boundDiff - diff : diff - boundDiff);
}

interface LiveOrder extends RestingOrder {
  remaining: number;
  /** Filled, or a sell with nothing left to sell: the server closed it. */
  closed: boolean;
}

interface Holding {
  higher: number;
  lower: number;
}

interface Step {
  shares: number;
  credits: number;
  left: number;
  closed: boolean;
}

interface RoundEntry {
  orderId: string;
  shares: number;
  credits: number;
  diffAfter: number;
}

class Book {
  q: [number, number];
  readonly holdings = new Map<number, Holding>();

  constructor(
    prob: number,
    readonly b: number,
    readonly rangeMin: number,
    readonly rangeMax: number,
  ) {
    // LMSR is translation-invariant, so a book anchored at q_lower = 0 prices
    // every move exactly as the server's absolute book does.
    const p = Math.min(1 - 1e-12, Math.max(1e-12, prob));
    this.q = [0, b * Math.log(p / (1 - p))];
  }

  holding(holder: number): Holding {
    let h = this.holdings.get(holder);
    if (!h) {
      h = { higher: 0, lower: 0 };
      this.holdings.set(holder, h);
    }
    return h;
  }

  /** A buy lands, then the holder's matched pairs are redeemed: no price move. */
  buy(holder: number, d: 0 | 1, shares: number): void {
    this.q[d] += shares;
    const h = this.holding(holder);
    h[d === 1 ? 'higher' : 'lower'] += shares;
    const pairs = Math.min(h.higher, h.lower);
    if (pairs > 1e-9) {
      h.higher -= pairs;
      h.lower -= pairs;
      this.q = [this.q[0] - pairs, this.q[1] - pairs];
    }
  }

  sell(holder: number, d: 0 | 1, shares: number): void {
    this.q[d] -= shares;
    this.holding(holder)[d === 1 ? 'higher' : 'lower'] -= shares;
  }
}

const dirIndex = (direction: 'higher' | 'lower'): 0 | 1 => (direction === 'higher' ? 1 : 0);

/** A buy of higher and a sell of lower wait for the call to come DOWN to their limit. */
const waitsBelow = (o: RestingOrder) => (o.side === 'sell') !== (o.direction === 'higher');

function fillBuy(book: Book, o: LiveOrder): Step | null {
  const r = betTowardsValue(book.q, book.b, book.rangeMin, book.rangeMax, o.limitValue, o.remaining);
  // The server refuses a trade too small and a fill that would move the wrong way.
  if (r.amount <= 0 || r.direction !== dirIndex(o.direction)) return null;
  book.buy(o.holder, r.direction, r.amount);
  const left = o.remaining - r.cost;
  return { shares: r.amount, credits: r.cost, left, closed: left <= 0.01 };
}

function fillSell(book: Book, o: LiveOrder): Step | null {
  const d = dirIndex(o.direction);
  const held = book.holding(o.holder)[o.direction];
  const toSell = Math.floor(Math.min(o.remaining, held) * CREDIT_PRECISION) / CREDIT_PRECISION;
  if (!(toSell > SHARE_EPS)) return { shares: 0, credits: 0, left: o.remaining, closed: true };
  let amount = toSell;
  const room = sharesToBound(book.q, book.b, book.rangeMin, book.rangeMax, d, true, o.limitValue);
  if (amount > room) {
    const capped = Math.floor(room * CREDIT_PRECISION) / CREDIT_PRECISION;
    if (!(capped > 0)) return null;
    amount = capped;
  }
  const proceeds = directionSellProceeds(book.q, d, amount, book.b);
  if (proceeds <= 0) return null;
  book.sell(o.holder, d, amount);
  const left = o.remaining - amount;
  const done = left <= SHARE_EPS;
  const gone = !done && held - amount <= SHARE_EPS;
  return { shares: amount, credits: proceeds, left, closed: done || gone };
}

function repeatedRound(history: RoundEntry[], b: number): [RoundEntry, RoundEntry] | null {
  if (history.length < 4) return null;
  const [a1, b1, a2, b2] = history.slice(-4);
  const same = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
  if (a1.orderId !== a2.orderId || b1.orderId !== b2.orderId || a2.orderId === b2.orderId) return null;
  if (!same(a1.shares, a2.shares) || !same(b1.shares, b2.shares)) return null;
  if (!same(a1.credits, a2.credits) || !same(b1.credits, b2.credits)) return null;
  if (Math.abs(b1.diffAfter - b2.diffAfter) > 1e-9 * Math.max(1, b)) return null;
  return [a2, b2];
}

function affordableRounds(book: Book, orders: [LiveOrder, LiveOrder], round: [RoundEntry, RoundEntry]): number {
  let most = Number.POSITIVE_INFINITY;
  for (const i of [0, 1] as const) {
    const o = orders[i];
    const entry = round[i];
    const partner = orders[1 - i];
    if (!(entry.shares > 0)) return 0;
    if (o.side === 'sell') {
      most = Math.min(most, Math.floor((o.remaining - SHARE_EPS) / entry.shares));
      const refill =
        partner.side === 'buy' && partner.holder === o.holder && partner.direction === o.direction
          ? round[1 - i].shares
          : 0;
      const drain = entry.shares - refill;
      if (drain > 1e-12) {
        most = Math.min(most, Math.floor((book.holding(o.holder)[o.direction] - SHARE_EPS) / drain));
      }
    } else {
      if (!(entry.credits > 0)) return 0;
      most = Math.min(most, Math.floor((o.remaining - 0.01) / entry.credits));
    }
  }
  return Number.isFinite(most) ? Math.max(0, most - 1) : 0;
}

/** Book `rounds` whole rounds of two opposing orders at once; nothing if any part cannot go. */
function bookRounds(
  book: Book,
  orders: [LiveOrder, LiveOrder],
  round: [RoundEntry, RoundEntry],
  rounds: number,
): boolean {
  const pairs = [
    [orders[0], round[0]],
    [orders[1], round[1]],
  ] as const;
  // Buys before sells, so a sell never meets a position its partner has not yet bought into.
  const ordered = [...pairs].sort((a, b) => (a[0].side === 'sell' ? 1 : 0) - (b[0].side === 'sell' ? 1 : 0));
  const savedQ: [number, number] = [book.q[0], book.q[1]];
  const savedHoldings = new Map([...book.holdings].map(([k, h]) => [k, { ...h }]));
  for (const [o, entry] of ordered) {
    const shares = entry.shares * rounds;
    const d = dirIndex(o.direction);
    if (o.side === 'sell') {
      if (book.holding(o.holder)[o.direction] < shares || !(entry.credits * rounds > 0)) {
        book.q = savedQ;
        book.holdings.clear();
        for (const [k, h] of savedHoldings) book.holdings.set(k, h);
        return false;
      }
      book.sell(o.holder, d, shares);
    } else {
      book.buy(o.holder, d, shares);
    }
  }
  for (const [o, entry] of ordered) {
    o.remaining -= o.side === 'sell' ? entry.shares * rounds : entry.credits * rounds;
  }
  return true;
}

/** One fill pass, as fillLimitOrdersInTx runs it. Returns the fills it made. */
function runPass(book: Book, live: LiveOrder[], roundsAtOnce: boolean): number {
  const eps = Math.max((book.rangeMax - book.rangeMin) * 1e-6, 1e-9);
  const blocked = new Set<string>();
  const history: RoundEntry[] = [];
  let fills = 0;

  for (let step = 0; step < PASS_STEPS; step++) {
    const current = consensusOf(book.q, book.b, book.rangeMin, book.rangeMax);
    // The order the price passed furthest is the one it reached first.
    let next: LiveOrder | null = null;
    let bestDepth = 0;
    for (const o of live) {
      if (o.closed || blocked.has(o.id)) continue;
      if (o.side === 'sell' ? o.remaining <= SHARE_EPS : o.remaining <= 0.01) continue;
      const crossed = waitsBelow(o) ? current <= o.limitValue + eps : current >= o.limitValue - eps;
      if (!crossed) continue;
      const depth = Math.abs(current - o.limitValue);
      if (!next || depth > bestDepth) {
        next = o;
        bestDepth = depth;
      }
    }
    if (!next) break;
    const order: LiveOrder = next;

    if (
      order.side === 'sell' &&
      !(
        sharesToBound(book.q, book.b, book.rangeMin, book.rangeMax, dirIndex(order.direction), true, order.limitValue) >
        SHARE_EPS
      )
    ) {
      blocked.add(order.id);
      continue;
    }

    const done = order.side === 'sell' ? fillSell(book, order) : fillBuy(book, order);
    if (!done) {
      blocked.add(order.id);
      continue;
    }
    order.remaining = done.left;
    if (done.closed) {
      order.closed = true;
      blocked.add(order.id);
    }
    if (done.shares > 0) {
      fills += 1;
      history.push({ orderId: order.id, shares: done.shares, credits: done.credits, diffAfter: book.q[1] - book.q[0] });
    } else {
      history.length = 0;
    }

    if (!roundsAtOnce) continue;
    const round = repeatedRound(history, book.b);
    if (!round) continue;
    history.length = 0;
    const pair: [LiveOrder, LiveOrder] = [
      live.find(o => o.id === round[0].orderId)!,
      live.find(o => o.id === round[1].orderId)!,
    ];
    const rounds = affordableRounds(book, pair, round);
    if (rounds >= 1 && bookRounds(book, pair, round, rounds)) fills += 2;
  }
  return fills;
}

/**
 * The probability the book rests at once every order a trade crossed has
 * filled. `prob` is where the trade alone leaves it; `heldChange` is what the
 * trade does to the trader's own holdings, applied to the holder of the
 * trader's own orders (named by `orderIds`), since a sell can only sell what
 * its holder holds when it fills. Nothing crossed returns `prob` unchanged.
 */
export function settleThroughOrders(input: {
  prob: number;
  liquidity: number;
  rangeMin: number;
  rangeMax: number;
  orders: RestingOrder[];
  now?: number;
  heldChange?: { orderIds: string[]; higher: number; lower: number };
  /** Book two opposing orders' repeated rounds at once, as the server does. Off only to test that it changes nothing. */
  roundsAtOnce?: boolean;
}): number {
  const { prob, liquidity, rangeMin, rangeMax, orders } = input;
  if (!(liquidity > 0) || !(rangeMax > rangeMin) || orders.length === 0) return prob;

  const now = input.now ?? Date.now();
  const book = new Book(prob, liquidity, rangeMin, rangeMax);
  const live: LiveOrder[] = [];
  for (const o of orders) {
    if (o.expiresAt && Date.parse(o.expiresAt) <= now) continue;
    if (!book.holdings.has(o.holder)) {
      book.holdings.set(o.holder, { higher: Math.max(0, o.held.higher), lower: Math.max(0, o.held.lower) });
    }
    live.push({ ...o, remaining: o.left, closed: false });
  }
  if (live.length === 0) return prob;

  const change = input.heldChange;
  const own = change ? live.find(o => change.orderIds.includes(o.id)) : undefined;
  if (change && own) {
    const h = book.holding(own.holder);
    h.higher = Math.max(0, h.higher + change.higher);
    h.lower = Math.max(0, h.lower + change.lower);
  }

  const roundsAtOnce = input.roundsAtOnce ?? true;
  let filled = false;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (runPass(book, live, roundsAtOnce) === 0) break;
    filled = true;
  }
  return filled ? pHigher(book.q, liquidity) : prob;
}
