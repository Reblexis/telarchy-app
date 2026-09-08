/**
 * Trim legacy balances to what the earn table pays today
 * (services/legacy-balance-cap.ts; docs/guides/credits.md, "A price cut
 * applies to what was already granted"). Dry run by default; --apply writes.
 *
 *   DATABASE_URL=... npx tsx scripts/cap-legacy-balances.ts [--apply] [--cap 10000]
 *
 * Two exemptions, both described by what they are rather than by a list of
 * opaque ids:
 *
 *  - house accounts (platform_operated / platform_admin). Their balances are
 *    the float the floor pays proposal rewards and auto-funds stakes from, so
 *    capping them stops the floor. The service excludes them itself.
 *  - the operator's own demo participants, whose auth email is on
 *    @agents.vcihal.com. They sit one grant schedule over the cap, have never
 *    placed a trade, and are not in the competition (owner decision
 *    2026-09-08: "people only").
 *
 * ZEROED rather than capped: `mqmmd2linqr4kgvyftoiuup3ybu2`, a row with no
 * nickname, no auth user and no trade, holding 7,000,000,000 credits from one
 * `opening_balance / 0060-backfill` row - 99.97% of every credit on the
 * platform, and a pre-nanocredit balance read as if it were already in
 * nanocredits. Capping it would leave a dead row holding a newcomer's whole
 * bankroll, so it goes to zero.
 */
import { eq, like } from 'drizzle-orm';
import { db } from '../src/db/client';
import { agents, authUser } from '../src/db/schema';
import { capLegacyBalances } from '../src/services/legacy-balance-cap';

const DEMO_EMAIL_LIKE = '%@agents.vcihal.com';
const ZERO_IDS = ['mqmmd2linqr4kgvyftoiuup3ybu2'];
const REF_ID = 'legacy-balance-cap-2026-09-08';

const apply = process.argv.includes('--apply');
const capArg = process.argv.indexOf('--cap');
const capCredits = capArg > -1 ? Number(process.argv[capArg + 1]) : 10_000;

async function main() {
  const exempt = await db
    .select({ id: agents.id, email: authUser.email })
    .from(agents)
    .innerJoin(authUser, eq(authUser.id, agents.authUserId))
    .where(like(authUser.email, DEMO_EMAIL_LIKE));

  const trims = await capLegacyBalances({
    capCredits,
    refId: REF_ID,
    zeroIds: ZERO_IDS,
    exemptIds: exempt.map(e => e.id),
    apply,
  });

  console.log(`cap ${capCredits.toLocaleString()} credits; ${exempt.length} demo participants exempt`);
  for (const t of trims) {
    console.log(
      `${apply ? 'trimmed' : 'would trim'} ${t.agentId}: ` +
        `${(t.beforeUnits / 1e9).toLocaleString()} -> ${(t.afterUnits / 1e9).toLocaleString()}`,
    );
  }
  const removed = trims.reduce((sum, t) => sum - t.deltaUnits, 0) / 1e9;
  console.log(
    `${trims.length} participants, ${removed.toLocaleString()} credits removed` +
      `${apply ? '' : ' (dry run, pass --apply to write)'}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
