/**
 * The Publish button's actual conversation with Cloud Run.
 *
 * Regression (2026-08-21, the button's first real press): publishRevision
 * PATCHed a partial spec at the Knative-style services endpoint. That API
 * has no PATCH, so the Google front end answered 404 as an HTML page and
 * every press of "Publish this build" surfaced as "Internal error" - while
 * the error text blamed IAM, which was fine. The contract this pins: GET
 * the whole service, rewrite spec.traffic, PUT the WHOLE object back
 * (metadata included - it carries the resourceVersion Cloud Run checks),
 * keeping tagged entries so the beta URL survives the publish.
 */

import { publishRevision } from '../services/release';

const SERVICE_URL_PART = '/namespaces/telarchy-e0043/services/api';

const fetched: Array<{ url: string; init?: RequestInit }> = [];

function mockCloudRun(serviceObject: Record<string, unknown>) {
  global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    fetched.push({ url: u, init });
    if (u.includes('metadata.google.internal') || u.includes('computeMetadata')) {
      return new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 });
    }
    if (u.includes(SERVICE_URL_PART) && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify(serviceObject), { status: 200 });
    }
    if (u.includes(SERVICE_URL_PART) && init?.method === 'PUT') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    // Any other shape (a PATCH, a wrong path) is exactly the bug: refuse it
    // the way the real front end does.
    return new Response('<!DOCTYPE html>not found', { status: 404 });
  }) as typeof fetch;
}

const origFetch = global.fetch;
const origEnv = { K_REVISION: process.env.K_REVISION };

beforeEach(() => {
  fetched.length = 0;
  process.env.K_REVISION = 'api-00999-new';
});
afterEach(() => {
  global.fetch = origFetch;
  if (origEnv.K_REVISION === undefined) delete process.env.K_REVISION;
  else process.env.K_REVISION = origEnv.K_REVISION;
});

describe('publishRevision speaks ReplaceService', () => {
  const service = {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    metadata: { name: 'api', resourceVersion: 'rv-123' },
    spec: {
      template: { metadata: { name: 'api-00999-new' } },
      traffic: [{ revisionName: 'api-00998-old', percent: 100 }],
    },
    status: {
      traffic: [
        { revisionName: 'api-00998-old', percent: 100 },
        { revisionName: 'api-00999-new', tag: 'candidate', url: 'https://candidate---x.run.app' },
      ],
    },
  };

  test('publishes with a PUT of the whole service, traffic rewritten, tags kept', async () => {
    mockCloudRun(service);
    const result = await publishRevision();
    expect(result.published).toBe('api-00999-new');

    const put = fetched.find(f => f.init?.method === 'PUT');
    expect(put).toBeDefined();
    expect(put!.url).toContain(SERVICE_URL_PART);

    const body = JSON.parse(String(put!.init!.body));
    // The whole object went back, resourceVersion included.
    expect(body.metadata?.resourceVersion).toBe('rv-123');
    expect(body.apiVersion).toBe('serving.knative.dev/v1');
    // Traffic moved to the revision being published...
    expect(body.spec.traffic).toContainEqual({ revisionName: 'api-00999-new', percent: 100 });
    // ...and the candidate tag survived, so /beta keeps resolving.
    expect(body.spec.traffic).toContainEqual({ revisionName: 'api-00999-new', tag: 'candidate' });
    // Nothing untagged points at the old revision any more.
    expect(
      body.spec.traffic.filter(
        (t: { revisionName?: string; tag?: string }) => t.revisionName === 'api-00998-old' && !t.tag,
      ),
    ).toHaveLength(0);
  });

  test('never PATCHes (the method the API answers with an HTML 404)', async () => {
    mockCloudRun(service);
    await publishRevision();
    expect(fetched.some(f => f.init?.method === 'PATCH')).toBe(false);
  });

  test('a refused replace surfaces as an error, not a silent success', async () => {
    mockCloudRun(service);
    const inner = global.fetch;
    global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response('<!DOCTYPE html>', { status: 404 });
      return inner(url, init);
    }) as typeof fetch;
    await expect(publishRevision()).rejects.toThrow(/404/);
  });
});
