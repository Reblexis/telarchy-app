/**
 * Backfill proposals.decidedPricing for proposals decided before the record
 * existed (see services/decided-pricing-backfill.ts). Dry run by default;
 * --apply writes; --recompute rewrites every decided proposal, record or not.
 *
 *   DATABASE_URL=... npx tsx scripts/backfill-decided-pricing.ts [--apply] [--recompute]
 *
 * The untraded books re-anchored by hand on 2026-09-02 are priced from
 * ../notes/reanchor-2026-09-02-before.json, their state before the
 * re-anchor, because the decision was made on that state.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type BookOverride, backfillDecidedPricing } from '../src/services/decided-pricing-backfill';

const apply = process.argv.includes('--apply');
const recompute = process.argv.includes('--recompute');
const beforePath = resolve(__dirname, '../../notes/reanchor-2026-09-02-before.json');
const before = JSON.parse(readFileSync(beforePath, 'utf8')) as Array<{
  id: string;
  shares: [number, number];
  liquidity: number;
}>;
const overrides = new Map<string, BookOverride>(before.map(b => [b.id, { shares: b.shares, liquidity: b.liquidity }]));

backfillDecidedPricing({ overrides, apply, recompute })
  .then(rows => {
    for (const r of rows) {
      const pairs = r.pricing.map(p => `${p.targetDate}: ${p.approvedConsensus} vs ${p.declinedConsensus}`).join('; ');
      console.log(`${apply ? 'wrote' : 'would write'} ${r.status} ${r.proposalId} (${r.workspaceId}): ${pairs}`);
    }
    console.log(`${rows.length} proposals${apply ? '' : ' (dry run, pass --apply to write)'}`);
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
