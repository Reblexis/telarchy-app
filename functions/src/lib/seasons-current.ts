import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { prizeSeasons } from '../db/schema';

/** The running season's id, or null when none runs. */
export async function currentSeasonId(): Promise<string | null> {
  const [row] = await db
    .select({ id: prizeSeasons.id })
    .from(prizeSeasons)
    .where(eq(prizeSeasons.status, 'running'))
    .limit(1);
  return row?.id ?? null;
}
