import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, setActiveWorkspace } from '../api';

/**
 * The api page calls a small set of new wrappers. This test pins their
 * URL/method/body shapes so a typo in api.ts gets caught at unit-test time
 * rather than at the network layer in dev.
 */

describe('api.ts key-management wrappers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    setActiveWorkspace('ws-1');
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setActiveWorkspace(null);
  });

  test('listAgentKeys hits GET /api/agents/:id/keys with X-Workspace-Id', async () => {
    await api.listAgentKeys('bot-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/agents\/bot-1\/keys$/);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Workspace-Id']).toBe('ws-1');
  });

  test('mintAgentKey POSTs the body unchanged', async () => {
    await api.mintAgentKey('bot-1', { label: 'prod', scopes: ['workspace:read'] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/agents\/bot-1\/keys$/);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ label: 'prod', scopes: ['workspace:read'] });
  });

  test('updateAgentKey PATCHes /:id/keys/:keyId', async () => {
    await api.updateAgentKey('bot-1', 'key-uuid', { scopes: ['workspace:read'] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/agents\/bot-1\/keys\/key-uuid$/);
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ scopes: ['workspace:read'] });
  });

  test('revokeAgentKey DELETEs /:id/keys/:keyId', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await api.revokeAgentKey('bot-1', 'key-uuid');
    expect(res).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/agents\/bot-1\/keys\/key-uuid$/);
    expect((init as RequestInit).method).toBe('DELETE');
  });

  test('createAgent POSTs to /api/agents with the full body', async () => {
    await api.createAgent({
      agentId: 'my-bot',
      nickname: 'Anchor',
      keyLabel: 'prod',
      keyScopes: ['workspace:read', 'workspace:trade'],
      memberships: [{ workspaceId: 'ws-1', groupIds: ['g1'] }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/agents$/);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      agentId: 'my-bot',
      nickname: 'Anchor',
      keyLabel: 'prod',
      keyScopes: ['workspace:read', 'workspace:trade'],
      memberships: [{ workspaceId: 'ws-1', groupIds: ['g1'] }],
    });
  });

  test('agent IDs with special characters are URL-encoded', async () => {
    await api.listAgentKeys('me');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/agents\/me\/keys$/);
    fetchMock.mockClear();
    // Real-world agent IDs are validated, but defense-in-depth: encodeURIComponent is in place.
    await api.listAgentKeys('weird/id with spaces');
    const [url2] = fetchMock.mock.calls[0];
    expect(url2).toMatch(/\/api\/agents\/weird%2Fid%20with%20spaces\/keys$/);
  });
});
