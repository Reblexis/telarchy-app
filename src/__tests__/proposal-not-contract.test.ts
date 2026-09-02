import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { describe, expect, test } from 'vitest';

/**
 * The thing on the ballot is a PROPOSAL, never a "contract" or a "job"
 * (docs/ui-conventions.md). An owner puts their own actions on the ballot
 * beside the ones strangers offer, and an owner's proposal has no ask and no
 * counterparty, so "contract" is the wrong word for it; and the API, the
 * skill and the guides already said proposal, so the floor saying contract
 * was the one place a visitor read a second word for the same thing.
 *
 * This scans everything a visitor reads: the frontend, the guides, the
 * server prose that reaches them (emails and the bell, Otto's brief and his
 * system prompt, the setup checklist, the /api/help catalog, llms.txt), and
 * the convention doc itself. What survives is listed below with its reason:
 *
 *   - "contractor": the person who gets paid keeps their noun.
 *   - API identifiers the rename deliberately left alone: quoted keys and
 *     paths (`'contracts'`, `/contracts`), property access (`.contracts`),
 *     object keys (`contracts:`), camelCase continuations (`contractsTotal`).
 *   - "contract" in its other sense, qualified: an API contract, a privacy
 *     contract, a USDC contract, a retainer contract.
 */

const ROOT = resolve(__dirname, '../..');

const SCANNED_DIRS = ['src/components', 'src/pages', 'docs/guides'];
const SCANNED_FILES = [
  'docs/ui-conventions.md',
  'docs/owner-on-the-floor.md',
  'functions/src/services/notifications.ts',
  'functions/src/services/workspace-context.ts',
  'functions/src/services/otto-tools.ts',
  'functions/src/lib/ask.ts',
  'functions/src/lib/setup-spec.ts',
  'functions/src/lib/help-catalog.ts',
  'public/llms.txt',
  'public/llms-full.txt',
  'index.html',
];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : filesUnder(full);
    return /\.(tsx?|md|txt|html)$/.test(name) ? [full] : [];
  });
}

const files = [
  ...SCANNED_DIRS.flatMap(d => filesUnder(resolve(ROOT, d))),
  ...SCANNED_FILES.map(f => resolve(ROOT, f)),
].map(f => ({ path: relative(ROOT, f), text: readFileSync(f, 'utf8') }));

/** The word in its other senses, or as an identifier: removed before counting. */
const ALLOWED = [
  /\w*[Cc]ontractors?\b/g,
  // Identifiers: quoted, path segment, property access, object key, camelCase.
  /(['"`])[Cc]ontracts?\1/g,
  /[/.[][Cc]ontracts?\b/g,
  /(^\s*|[{,(]\s*)[Cc]ontracts?\s*:/g, // an object key
  /\b[Cc]ontracts?(?=\s*[\]=]|[A-Z])/g,
  /^\s*contracts,\s*$/g, // an object-shorthand property on its own line
  // The word's own meaning, qualified.
  /\b(API|HTTP|server|privacy|public-payload|read|wire|type|USDC|retainer|recurring|engine's|its own)\s+contracts?\b/gi,
  /\bcontract is docs\//g,
  /\b(is|as) the contract\b/g, // "GET /api/help is the contract"
  /\(contract: docs\//g,
];

function offenders(text: string): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    let stripped = line;
    for (const re of ALLOWED) stripped = stripped.replace(re, ' ');
    if (/\b[Cc]ontracts?\b/.test(stripped)) out.push(`${i + 1}: ${line.trim()}`);
  });
  return out;
}

test('the scan actually sees the floor', () => {
  const paths = files.map(f => f.path);
  expect(paths).toContain('src/components/JobsBoard.tsx');
  expect(paths).toContain('functions/src/services/notifications.ts');
  expect(paths.some(p => p.startsWith('docs/guides/'))).toBe(true);
});

describe('what a visitor reads says proposal', () => {
  test('never "contract" as the name of the thing on the ballot', () => {
    const hits = files.flatMap(f => offenders(f.text).map(l => `${f.path}:${l}`));
    expect(hits).toEqual([]);
  });

  test('the allowlist still lets the other senses through', () => {
    expect(offenders('Top contractors, and a contractor who was paid')).toEqual([]);
    expect(offenders('treat GET /api/help as the API contract; the privacy contract of /api/leaderboard')).toEqual([]);
    expect(
      offenders(
        "contracts: [{ id }], contractsTotal, olderContractsOmitted, '/contracts', ctx.contracts, ['contracts']",
      ),
    ).toEqual([]);
    expect(offenders('the USDC contract on Base; retainer contracts at week end')).toEqual([]);
  });

  test('and catches the noun', () => {
    expect(offenders('Suggest a contract')).toHaveLength(1);
    expect(offenders('No contracts on the board yet.')).toHaveLength(1);
    expect(offenders('A Contract was decided')).toHaveLength(1);
  });
});
