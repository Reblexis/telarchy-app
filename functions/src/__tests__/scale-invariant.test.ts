/**
 * The invariant behind the 2026-08-20 outage, pinned:
 *
 *   (prod instances + candidate instances) x pool max  <=  max_connections - headroom
 *
 * Cloud SQL telarchy-pg runs max_connections=100 (50 until 2026-08-26, when
 * branch previews needed room); cloud-sql-proxy sessions, migrations and cron
 * need headroom, so the app's budget is 80. Instances come from
 * --max-instances in the CI deploy (the prod revision and the no-traffic
 * candidate at 4 each, up to three branch previews at 1); connections per
 * instance from the pool in db/client.ts (DB_POOL_MAX, 4 or 1, plus the beta
 * pool). Nothing in the repo stated this arithmetic before
 * tonight, and it was only violated at scale-out, which is exactly when
 * nobody is watching. If this test fails, re-do the arithmetic in
 * docs/infra/deploy.md ("connection budget") before touching the numbers.
 * (Suggested by the telarchy-0a session during the outage review.)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { BETA_POOL_MAX, POOL_MAX, pool } from '../db/client';

const ROOT = join(__dirname, '../../..');
const workflow = readFileSync(join(ROOT, '.github/workflows/deploy-cloudrun.yml'), 'utf8');
const deployDoc = readFileSync(join(ROOT, 'docs/infra/deploy.md'), 'utf8');

/** The `gcloud run deploy` block that lands a given tag. */
function deployBlock(tag: string): string {
  const at = workflow.indexOf(`--no-traffic --tag ${tag}`);
  if (at < 0) throw new Error(`deploy-cloudrun.yml no longer deploys with --tag ${tag}`);
  const end = workflow.indexOf('--quiet', at);
  return workflow.slice(at, end);
}

function flag(block: string, name: string): number {
  const m = block.match(new RegExp(`--${name}\\s+(\\d+)`));
  if (!m) throw new Error(`deploy block does not set --${name}`);
  return Number(m[1]);
}

function envVar(block: string, name: string): number {
  const m = block.match(new RegExp(`${name}=(\\d+)`));
  if (!m) throw new Error(`deploy block does not set ${name}`);
  return Number(m[1]);
}

/** What docs/infra/deploy.md promises the instance is configured with. */
function documentedMaxConnections(): number {
  const m = deployDoc.match(/`max_connections=(\d+)`/);
  if (!m) throw new Error('docs/infra/deploy.md no longer states max_connections');
  return Number(m[1]);
}

const PREVIEW_CAP = 3; // docs/infra/deploy.md, "Branch previews"
/** The workflow's own expression for the preview tag; spelled in two halves
 *  so the linter does not read it as a template literal. */
const PREVIEW_TAG_EXPR = '$' + '{{ steps.tag.outputs.tag }}';
const HEADROOM = 20; // cloud-sql-proxy, cron, psql, the migration step

describe('connection budget invariant', () => {
  const main = deployBlock('candidate');
  const preview = deployBlock(PREVIEW_TAG_EXPR);

  it('prod + candidate + three previews at full scale stay inside the database budget', () => {
    expect(pool.options.max).toBe(POOL_MAX);
    // Since 2026-08-20 an instance can hold TWO pools: the live store, and the
    // beta store if a beta request ever reaches it (db/client.ts). The worst
    // case has to count both, or the budget silently doubles the first time
    // somebody opens the beta.
    const perInstance = envVar(main, 'DB_POOL_MAX') + BETA_POOL_MAX;
    const mainWorst = 2 * flag(main, 'max-instances') * perInstance; // prod revision + candidate revision
    // A preview: one instance, a 1-connection production pool (sessions) plus
    // the beta pool, at most PREVIEW_CAP of them (docs/infra/deploy.md).
    const previewPerInstance = envVar(preview, 'DB_POOL_MAX') + BETA_POOL_MAX;
    const previewWorst = PREVIEW_CAP * flag(preview, 'max-instances') * previewPerInstance;
    const budget = documentedMaxConnections() - HEADROOM;
    expect(mainWorst).toBe(40);
    expect(previewWorst).toBe(6);
    expect(mainWorst + previewWorst).toBeLessThanOrEqual(budget);
  });

  it('the doc and the pool agree on the default', () => {
    expect(envVar(main, 'DB_POOL_MAX')).toBe(POOL_MAX);
  });
});

/**
 * `gcloud run deploy` starts from the previous revision's template, so the
 * main deploy must restate its scale and pool every run or it inherits a
 * preview's. The preview must state its own, smaller ones.
 */
describe('the deploy blocks state their scale explicitly', () => {
  const main = deployBlock('candidate');
  const preview = deployBlock(PREVIEW_TAG_EXPR);

  it('main: 4 instances, a 4-connection pool, one warm instance', () => {
    expect(flag(main, 'max-instances')).toBe(4);
    expect(flag(main, 'min-instances')).toBe(1);
    expect(envVar(main, 'DB_POOL_MAX')).toBe(4);
  });

  it('preview: one instance, a 1-connection pool, nothing kept warm', () => {
    expect(flag(preview, 'max-instances')).toBe(1);
    expect(flag(preview, 'min-instances')).toBe(0);
    expect(envVar(preview, 'DB_POOL_MAX')).toBe(1);
  });

  it('the cap in the workflow is the cap in the doc', () => {
    const m = workflow.match(/KEEP = (\d+)/);
    expect(m && Number(m[1])).toBe(PREVIEW_CAP);
    expect(deployDoc).toMatch(/keeps the 3 newest `br-\*`\s+tags/);
  });

  // Billing (docs/infra/deploy.md, "CPU allocation"): the prod revision serves
  // cron every 10 minutes plus steady traffic, so it is active most of the
  // month; instance-based billing (CPU always allocated) is ~4x cheaper per
  // vCPU-hour than request-based for an instance that is rarely idle. A
  // preview idles, so it stays request-based. Both must be stated, because
  // the deploy inherits the previous revision's allocation otherwise.
  it('main: CPU always allocated (instance-based billing)', () => {
    expect(main).toMatch(/--no-cpu-throttling/);
    expect(main).not.toMatch(/\s--cpu-throttling/);
  });

  it('preview: CPU only during requests (request-based billing)', () => {
    expect(preview).toMatch(/\s--cpu-throttling/);
    expect(preview).not.toMatch(/--no-cpu-throttling/);
  });

  it('the hand deploy and the doc state the same allocation as the workflow', () => {
    const script = readFileSync(join(ROOT, 'scripts/deploy-managed.sh'), 'utf8');
    expect(script).toMatch(/--no-cpu-throttling/);
    expect(deployDoc).toMatch(/--no-cpu-throttling/);
    expect(deployDoc).toMatch(/## CPU allocation/);
  });

  it('a preview never migrates production', () => {
    const job = workflow.slice(workflow.indexOf('  preview:'), workflow.indexOf('  retire:'));
    expect(job).toContain('5435/telarchy_beta');
    expect(job).not.toContain('5435/telarchy"');
  });
});
