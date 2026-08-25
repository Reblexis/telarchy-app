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

export interface ReleaseState {
  /** The revision serving telarchy.com right now, or null if unknown. */
  serving: string | null;
  /** The revision waiting to be published, if it is not the serving one. */
  candidate: { revision: string; url: string } | null;
  /** The revision answering THIS request. */
  running: string | null;
  /** True when the process answering this request is the one serving the
   *  public site, i.e. you are not on the beta. */
  isServing: boolean;
  /** Set when Cloud Run could not be reached at all (local dev, missing IAM). */
  error: string | null;
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
    return { serving: null, candidate: null, running, isServing: false, error: 'no-metadata-server' };
  }
  const svc = await fetchService(token);
  if (!svc) {
    return { serving: null, candidate: null, running, isServing: false, error: 'describe-failed' };
  }
  const traffic = svc.status?.traffic ?? [];
  // What the public actually gets: the entry carrying the traffic. A tagged
  // entry with 0 percent is a candidate, not the site.
  const servingEntry = traffic.find(t => (t.percent ?? 0) > 0 && !t.tag) ?? traffic.find(t => (t.percent ?? 0) > 0);
  const serving = servingEntry?.revisionName ?? null;

  const tagged = traffic.find(t => t.tag === 'candidate');
  const candidate =
    tagged?.revisionName && tagged.revisionName !== serving
      ? { revision: tagged.revisionName, url: tagged.url ?? '' }
      : null;

  return {
    serving,
    candidate,
    running,
    isServing: !!serving && !!running && serving === running,
    error: null,
  };
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
