#!/usr/bin/env node
import { resolve } from 'node:path';
/**
 * The open-source release's success number: participants attributed to a
 * source who actually traded (docs/agent-economy.md "Attribution";
 * telarchy/notes/open-source-decision-2026-08-24.md).
 *
 *   DATABASE_URL=... node scripts/activated-participants.mjs github 2026-09-01 2026-10-01
 *
 * Counts agents whose source is <slug> (or who are the participant identity of
 * a user with that source), excluding platform-operated agents and agents owned
 * by a platform admin, with 3+ trades on 2+ distinct days in [start, end).
 * Read-only. Needs a built backend (cd functions && npm run build).
 */
import { pathToFileURL } from 'node:url';

const [source, start, end] = process.argv.slice(2);
if (!source || !start || !end) {
  console.error('usage: node scripts/activated-participants.mjs <source> <start ISO date> <end ISO date>');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('set DATABASE_URL (read-only access is enough)');
  process.exit(2);
}

const lib = p => import(pathToFileURL(resolve('functions/lib', p)).href);
const { db } = await lib('db/client.js').catch(() => {
  console.error('build the backend first: cd functions && npm run build');
  process.exit(2);
});
const { activatedParticipants } = await lib('lib/attribution.js');

const rows = await activatedParticipants(db, { source, start: new Date(start), end: new Date(end) });
for (const r of rows) console.log(`${r.agentId}\t${r.trades} trades\t${r.days} days`);
console.log(`${rows.length} activated participant(s) with source=${source} in [${start}, ${end})`);
process.exit(0);
