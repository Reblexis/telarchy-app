/**
 * Any branch can be built (docs/infra/deploy.md): the picker lists every
 * branch, marks the built ones, and a pick dispatches the deploy workflow on
 * that ref, or says which command does when the instance holds no token.
 */

import path from 'path';
import {
  BuildNotConfiguredError,
  dispatchBuild,
  joinBranches,
  previewTagFor,
  previewTagFromScript,
} from '../services/branches';

const REPO_ROOT = path.join(__dirname, '../../..');

describe('the preview tag rule lives once', () => {
  test('TypeScript and scripts/preview-tag.sh agree', () => {
    for (const name of [
      'oss/lane-i',
      'Setup_Door.Email',
      'main',
      'a-very-long-branch-name-that-goes-on-and-on-forever-and-more',
      'x--y',
      '-lead-',
      'ÜBER/straße',
    ]) {
      expect([name, previewTagFor(name)]).toEqual([name, previewTagFromScript(name, REPO_ROOT)]);
    }
  });

  test('a name that leaves nothing has no tag', () => {
    expect(previewTagFor('///')).toBeNull();
    expect(previewTagFromScript('///', REPO_ROOT)).toBeNull();
  });
});

describe('the list', () => {
  test('marks built branches, drops main, built first then by name', () => {
    const out = joinBranches(
      [
        { name: 'zeta', sha: 'z' },
        { name: 'main', sha: 'm' },
        { name: 'oss/lane-i', sha: 'o' },
        { name: 'alpha', sha: 'a' },
      ],
      [{ tag: 'br-oss-lane-i', revision: 'api-00700-x', url: 'https://x' }],
    );
    expect(out.map(b => [b.name, b.built])).toEqual([
      ['oss/lane-i', true],
      ['alpha', false],
      ['zeta', false],
    ]);
    expect(out[0].tag).toBe('br-oss-lane-i');
  });
});

describe('building', () => {
  const saved = process.env.GITHUB_ACTIONS_TOKEN;
  const origFetch = global.fetch;
  afterEach(() => {
    if (saved === undefined) delete process.env.GITHUB_ACTIONS_TOKEN;
    else process.env.GITHUB_ACTIONS_TOKEN = saved;
    global.fetch = origFetch;
  });

  test('without a token it names the command instead of pretending', async () => {
    delete process.env.GITHUB_ACTIONS_TOKEN;
    await expect(dispatchBuild('oss/lane-i')).rejects.toThrow(BuildNotConfiguredError);
    await expect(dispatchBuild('oss/lane-i')).rejects.toThrow(/gh workflow run deploy-cloudrun.yml --ref oss\/lane-i/);
  });

  test('with a token it dispatches the deploy workflow on that ref', async () => {
    process.env.GITHUB_ACTIONS_TOKEN = 'tok';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const r = await dispatchBuild('oss/lane-i');
    expect(r.tag).toBe('br-oss-lane-i');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://api.github.com/repos/Reblexis/telarchy-app/actions/workflows/deploy-cloudrun.yml/dispatches',
    );
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ref: 'oss/lane-i' });
    const sent = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(sent.Authorization).toBe('Bearer tok');
  });

  test('a refused dispatch is an error, not a silent success', async () => {
    process.env.GITHUB_ACTIONS_TOKEN = 'tok';
    global.fetch = (async () => new Response('{"message":"no"}', { status: 422 })) as typeof fetch;
    await expect(dispatchBuild('oss/lane-i')).rejects.toThrow(/422/);
  });
});
