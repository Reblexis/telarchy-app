/**
 * The publish gate: what is serving telarchy.com, what is waiting on the beta,
 * and the one call that swaps one for the other.
 *
 * Owner ask 2026-08-20: "i think deploying to prod is too easy". CI now lands
 * every green build as a Cloud Run revision carrying NO traffic, tagged
 * `candidate`, and stops. Until someone presses Publish, telarchy.com keeps
 * serving whatever it served before, and the new code exists only at the
 * candidate's own URL, which `/beta` sends a platform admin to.
 *
 * Why the Cloud Run API rather than a flag in our own database: traffic is the
 * actual fact. A row saying "published" that disagrees with what Google is
 * serving is worse than no row, and this way a promote done by hand
 * (`gcloud run services update-traffic`) is visible here immediately.
 *
 * Everything degrades to nulls off Cloud Run (local dev, tests): the page then
 * says it cannot see a release, which is honest, rather than inventing one.
 */

import { ttlCache } from '../lib/ttl-cache';

const REGION = process.env.CLOUD_RUN_REGION ?? 'us-central1';
const SERVICE = process.env.K_SERVICE ?? 'api';
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? 'telarchy-e0043';

/** The revision this very process is. Cloud Run sets it; empty off Cloud Run. */
export function currentRevision(): string | null {
  return process.env.K_REVISION || null;
}

/** The one tag Publish accepts. CI puts it on every green build of main. */
export const CANDIDATE_TAG = 'candidate';
/** Every pushed branch lands under `br-<name>` (scripts/preview-tag.sh). */
export const PREVIEW_TAG_PREFIX = 'br-';

export function isPreviewTag(tag: string): boolean {
  return /^br-[a-z0-9][a-z0-9-]{0,36}$/.test(tag);
}

export interface PreviewRevision {
  tag: string;
  revision: string;
  url: string;
}

export interface ReleaseState {
  /** The revision serving telarchy.com right now, or null if unknown. */
  serving: string | null;
  /** The revision waiting to be published, if it is not the serving one. */
  candidate: { revision: string; url: string } | null;
  /** Branch previews, newest revision first (docs/infra/deploy.md, "Branch
   *  previews"). The picker on the beta stripe lists these. */
  previews: PreviewRevision[];
  /** The revision answering THIS request. */
  running: string | null;
  /** Every tag pointing at the running revision; `br-...` means this is a
   *  branch preview and must not offer Publish. */
  runningTags: string[];
  /** True when the process answering this request is the one serving the
   *  public site, i.e. you are not on the beta. */
  isServing: boolean;
  /** Set when Cloud Run could not be reached at all (local dev, missing IAM). */
  error: string | null;
}

/** Thrown when a revision without the candidate tag is asked to be published.
 *  The route turns it into a 409: a branch reaches telarchy.com by merging to
 *  main, never by being published from the beta. */
export class PublishRefusedError extends Error {}

/** The counter in a Cloud Run revision name (`api-00584-fim` is 584); 0 when
 *  the name has another shape. Used to order previews, newest first. */
export function revisionNumber(name: string): number {
  const m = /-(\d+)-[a-z0-9]+$/.exec(name);
  return m ? Number(m[1]) : 0;
}

/**
 * A metadata-server access token for the runtime service account.
 *
 * No key files: on Cloud Run the metadata server mints a token for the
 * attached service account, which is why the IAM grant is what gates this
 * (the custom telarchyReleasePublisher role on the `api` service, see
 * docs/infra/deploy.md).
 */
async function accessToken(): Promise<string | null> {
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string };
    return body.access_token ?? null;
  } catch {
    // Off Cloud Run there is no metadata server. Not an error worth logging on
    // every request in local dev.
    return null;
  }
}

interface RunService {
  // The publish PUT sends the whole object back, so everything the GET
  // returned must survive the round trip (metadata carries the
  // resourceVersion Cloud Run checks against concurrent edits).
  apiVersion?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
  spec?: {
    traffic?: Array<{ revisionName?: string; percent?: number; tag?: string; latestRevision?: boolean }>;
  } & Record<string, unknown>;
  status?: {
    traffic?: Array<{ revisionName?: string; percent?: number; tag?: string; url?: string; latestRevision?: boolean }>;
    latestReadyRevisionName?: string;
  };
}

async function fetchService(token: string): Promise<RunService | null> {
  const url = `https://${REGION}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${PROJECT}/services/${SERVICE}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.error('release: Cloud Run describe failed', res.status, await res.text().catch(() => ''));
    return null;
  }
  return (await res.json()) as RunService;
}

/**
 * The traffic split changes when someone presses Publish and at no other time,
 * so asking Google on every request would be a network round trip per page
 * load on the beta (which proxies per request) for an answer that is almost
 * always the same one. Ten seconds is short enough that the stripe flips to
 * "published" while the owner is still looking at it.
 */
const releaseCache = ttlCache({
  ttlMs: 10_000,
  keyOf: () => 'release',
  load: () => computeReleaseState(),
});

/**
 * Whether a process running `running` should arm and run the scheduled jobs,
 * given that `serving` is the revision telarchy.com actually sends traffic to.
 *
 * Every revision arms every timer in server.ts at boot, and background work is
 * outside the per-request store swap BY CONSTRUCTION (db/client.ts: everything
 * outside a request gets production). So the candidate - always warm at
 * --min-instances 1, landed by every merge to main, hours before anyone
 * presses Publish - and every branch preview CI smoke-tests were running
 * settlement, the 12-second limit sweep and the daily refresh against live
 * markets with unreviewed code (bug hunt 2026-08-31, P0-3).
 *
 * Both fallbacks return TRUE, and deliberately:
 *
 *  - No `running` means this is not Cloud Run. A self-hosted or local instance
 *    is the only thing that will ever settle its own markets.
 *  - No `serving` means the answer could not be fetched. Failing closed there
 *    stops markets paying out silently, which is worse than the problem: the
 *    settlement claim in services/predictions.ts already makes a second
 *    resolver harmless rather than a double payout, so this gate is about
 *    unreviewed code touching live markets, not about money.
 */
export function revisionRunsScheduledJobs(running: string | null, serving: string | null): boolean {
  if (!running) return true;
  if (!serving) return true;
  return running === serving;
}

/** The same question, asked of this process. Cheap per tick: releaseState is
 *  TTL-cached, so at most one Cloud Run API call per ten seconds. */
export async function shouldRunScheduledJobs(): Promise<boolean> {
  const running = currentRevision();
  if (!running) return true;
  return revisionRunsScheduledJobs(running, (await releaseState()).serving);
}

/** Drop the cache: the answer just changed because we changed it. */
export function clearReleaseCache(): void {
  releaseCache.clear();
}

export function releaseState(): Promise<ReleaseState> {
  return releaseCache.get();
}

async function computeReleaseState(): Promise<ReleaseState> {
  const running = currentRevision();
  const token = await accessToken();
  if (!token) {
    return offline(running, 'no-metadata-server');
  }
  const svc = await fetchService(token);
  if (!svc) {
    return offline(running, 'describe-failed');
  }
  const traffic = svc.status?.traffic ?? [];
  // What the public actually gets: the entry carrying the traffic. A tagged
  // entry with 0 percent is a candidate, not the site.
  const servingEntry = traffic.find(t => (t.percent ?? 0) > 0 && !t.tag) ?? traffic.find(t => (t.percent ?? 0) > 0);
  const serving = servingEntry?.revisionName ?? null;

  const tagged = traffic.find(t => t.tag === CANDIDATE_TAG);
  const candidate =
    tagged?.revisionName && tagged.revisionName !== serving
      ? { revision: tagged.revisionName, url: tagged.url ?? '' }
      : null;

  const previews: PreviewRevision[] = traffic
    .filter(t => t.tag?.startsWith(PREVIEW_TAG_PREFIX) && t.revisionName)
    .map(t => ({ tag: t.tag as string, revision: t.revisionName as string, url: t.url ?? '' }))
    .sort((a, b) => revisionNumber(b.revision) - revisionNumber(a.revision));
  const runningTags = running ? traffic.filter(t => t.revisionName === running && t.tag).map(t => t.tag as string) : [];

  return {
    serving,
    candidate,
    previews,
    running,
    runningTags,
    isServing: !!serving && !!running && serving === running,
    error: null,
  };
}

function offline(running: string | null, error: string): ReleaseState {
  return { serving: null, candidate: null, previews: [], running, runningTags: [], isServing: false, error };
}

/** The `br-` tag on the revision answering this request, or null: the stripe
 *  names the branch from it. Null off Cloud Run without asking anything. */
export async function runningPreviewTag(): Promise<string | null> {
  if (!currentRevision()) return null;
  try {
    const state = await releaseState();
    return state.runningTags.find(t => t.startsWith(PREVIEW_TAG_PREFIX)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Publish a revision: give it 100% of the traffic.
 *
 * Defaults to the revision answering this request, which is the whole point of
 * the button living on the beta: you publish the thing you just looked at, not
 * "latest", which could be something CI landed while you were reading.
 */
export async function publishRevision(revision?: string): Promise<{ published: string }> {
  const target = revision ?? currentRevision();
  if (!target) throw new Error('No revision to publish (not running on Cloud Run)');

  const token = await accessToken();
  if (!token) throw new Error('No metadata server: publishing only works on Cloud Run');

  const svc = await fetchService(token);
  if (!svc) throw new Error('Could not read the service to publish it');

  // Only the main candidate is publishable. A branch preview carries a `br-`
  // tag and no `candidate` tag, and publishing it would put a branch on
  // telarchy.com without it ever touching main (docs/infra/deploy.md, "Branch
  // previews"). The tag is the fact; the missing button on the stripe is only
  // the courtesy.
  const carriesCandidate = (svc.status?.traffic ?? []).some(t => t.revisionName === target && t.tag === CANDIDATE_TAG);
  if (!carriesCandidate) {
    throw new PublishRefusedError(
      `Only the main candidate can be published: ${target} does not carry the candidate tag. A branch reaches telarchy.com by merging to main.`,
    );
  }

  // Keep the candidate TAG pointing where it points, so the beta URL stays
  // valid after a publish; only the untagged traffic split moves.
  const keptTags = (svc.status?.traffic ?? [])
    .filter(t => t.tag)
    .map(t => ({ revisionName: t.revisionName, tag: t.tag }));

  // ReplaceService: the Knative-style API takes no PATCH — the original
  // implementation PATCHed a partial spec and got an HTML 404 back from the
  // Google front end, so the button errored on every press while the IAM it
  // blamed was fine (found 2026-08-21, the first real press). The contract is
  // GET the whole service, rewrite spec.traffic, PUT the whole thing back —
  // exactly what `gcloud run services update-traffic` does.
  svc.spec = { ...svc.spec, traffic: [{ revisionName: target, percent: 100 }, ...keptTags] };
  const url = `https://${REGION}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${PROJECT}/services/${SERVICE}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(svc),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('release: publish failed', res.status, detail);
    throw new Error(
      `Cloud Run refused the publish (${res.status}). Check the service account still holds the telarchyReleasePublisher role on this service.`,
    );
  }
  clearReleaseCache();
  return { published: target };
}
