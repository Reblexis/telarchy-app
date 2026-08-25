#!/usr/bin/env node
/**
 * Walk a season's markets up a liquidity ramp, one small step at a time.
 *
 * Season 0 opens THIN on purpose (owner direction 2026-08-19: "the initial
 * liquidity should be small, we will add more liquidity over days of the
 * tournament"). A thin book means an early trader's credits actually move the
 * price, which is the recruiting argument; a thick one means the price is
 * worth reading, which is the product argument. The ramp buys both, in that
 * order.
 *
 * Why many small steps rather than a few big ones: raising b marks up every
 * open position, because a fatter book pays more for the same holding. That
 * gain is real score in a contest ranked on marked profit, and it goes to
 * whoever is holding, right or wrong. It is bounded by the spread they paid
 * (about 14% of stake over the whole ramp) and it washes out at resolution,
 * but each step hands out a slice of it, so the slices should be thin. See
 * docs/seasons.md.
 *
 * Idempotent: it computes the target pool for today from the schedule and
 * tops up the difference. Running it twice in a day is a no-op; missing a day
 * and running tomorrow catches up in one step.
 *
 *   TELARCHY_MASTER_KEY=... node scripts/season-liquidity-ramp.mjs [--dry-run]
 *
 * Ops: run it daily. It is deliberately not a cron inside the app: the
 * schedule is a judgement call the operator should be able to change, or
 * accelerate, when real volume shows up.
 */

const BASE = process.env.TELARCHY_API ?? 'https://telarchy.com/api';
const KEY = process.env.TELARCHY_MASTER_KEY;
const WORKSPACE = process.env.SEASON_WORKSPACE ?? '4f27b21c-e5f0-4c1d-970a-e145fdf4ca04';
/** Whose balance funds the ramp. House account, so the subsidy is the house's. */
const FUNDER = process.env.SEASON_FUNDER ?? 'lookpilot-kpi-sync';

/**
 * Pool credits by day of the season, doubling weekly until the book is deep
 * enough to read, then flat. b = pool / ln 2, so these are b = 2,000 ->
 * 4,000 -> 8,000 -> 16,700, and a 1,000-credit trade moves the consensus
 * $4,918 -> $2,588 -> $1,330 -> $727 on the hero market's $25,000 range.
 *
 * The whole ramp is spent by the end of week 4 of an eight-week season: depth
 * is worth having while there is still time to trade on it, and the last
 * weeks are when a mark-up handed to whoever is already holding does the most
 * damage to the standings.
 */
const SCHEDULE = [
  { day: 0, pool: 1386 },
  { day: 7, pool: 2772 },
  { day: 14, pool: 5544 },
  { day: 21, pool: 11576 },
];

/** Straight-line between the weekly rungs, so each day is a small step. */
function targetPool(dayIndex) {
  if (dayIndex <= SCHEDULE[0].day) return SCHEDULE[0].pool;
  const last = SCHEDULE[SCHEDULE.length - 1];
  if (dayIndex >= last.day) return last.pool;
  for (let i = 1; i < SCHEDULE.length; i++) {
    const a = SCHEDULE[i - 1],
      b = SCHEDULE[i];
    if (dayIndex <= b.day) {
      const t = (dayIndex - a.day) / (b.day - a.day);
      return a.pool + t * (b.pool - a.pool);
    }
  }
  return last.pool;
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'X-API-Key': KEY,
      'X-Workspace-Id': WORKSPACE,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  if (!KEY) throw new Error('TELARCHY_MASTER_KEY is not set (source keyring/telarchy/master.env)');
  const dryRun = process.argv.includes('--dry-run');

  const seasons = (await api('/seasons')).seasons ?? [];
  const season = seasons.find(s => s.status === 'running') ?? seasons.find(s => s.status === 'draft');
  if (!season) {
    console.log('No running or draft season. Nothing to ramp.');
    return;
  }

  const start = new Date(season.startsAt);
  const dayIndex = Math.floor((Date.now() - start.getTime()) / 86_400_000);
  const target = targetPool(dayIndex);
  console.log(
    `${season.name}: day ${dayIndex} -> target pool ${target.toFixed(0)} cr (b = ${(target / Math.LN2).toFixed(0)})`,
  );

  // Every open market on the season floor rides the same ramp, baseline and
  // contract branches alike: the game moves to whichever book is thinnest, so
  // there is no such thing as topping up only the headline one.
  const markets = await api('/predictions/markets?status=open&kind=all&limit=200');
  if (!markets.length) {
    console.log('No open markets.');
    return;
  }

  for (const m of markets) {
    const pool = m.liquidity * Math.LN2;
    const top = target - pool;
    const label = `${m.metricName} ${m.targetDate}${m.proposalId ? ` (${m.branch})` : ''}`;
    if (top <= 1) {
      console.log(`  = ${label}: pool ${pool.toFixed(0)}, already at or above target`);
      continue;
    }
    if (dryRun) {
      console.log(`  + ${label}: would add ${top.toFixed(0)} cr (pool ${pool.toFixed(0)} -> ${target.toFixed(0)})`);
      continue;
    }
    const res = await api(`/predictions/markets/${m.marketId ?? m.id}/liquidity`, {
      method: 'POST',
      body: JSON.stringify({ amount: Number(top.toFixed(2)), agentId: FUNDER }),
    });
    console.log(`  + ${label}: added ${top.toFixed(0)} cr, b now ${res.liquidity.toFixed(0)}`);
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
