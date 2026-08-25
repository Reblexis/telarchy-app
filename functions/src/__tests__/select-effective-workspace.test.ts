import { selectEffectiveWorkspaceId, type WorkspaceMembership } from '../lib/participants';

const admin = (id: string): WorkspaceMembership => ({ workspaceId: id, memberRole: 'admin' });
const owner = (id: string): WorkspaceMembership => ({ workspaceId: id, memberRole: 'owner' });
const trader = (id: string): WorkspaceMembership => ({ workspaceId: id, memberRole: 'trader' });
const viewer = (id: string): WorkspaceMembership => ({ workspaceId: id, memberRole: 'viewer' });

describe('selectEffectiveWorkspaceId', () => {
  test('returns null when the user has no memberships', () => {
    expect(selectEffectiveWorkspaceId([])).toBeNull();
    expect(selectEffectiveWorkspaceId([], 'stale-ws')).toBeNull();
  });

  test('returns the requested workspace when it matches a membership', () => {
    const memberships = [admin('ws1'), trader('ws2')];
    expect(selectEffectiveWorkspaceId(memberships, 'ws2')).toBe('ws2');
  });

  test('falls back to the highest-priority membership when requested is stale', () => {
    const memberships = [trader('ws2'), owner('ws1'), admin('ws3')];
    // Prevents a single stale X-Workspace-Id from locking a user out of the
    // whole API. Owner > admin > trader > viewer.
    expect(selectEffectiveWorkspaceId(memberships, 'ws-never-joined')).toBe('ws1');
  });

  test('falls back to the highest-priority membership when no workspace is requested', () => {
    const memberships = [viewer('ws2'), trader('ws1')];
    expect(selectEffectiveWorkspaceId(memberships)).toBe('ws1');
  });

  test('returns the only membership regardless of request', () => {
    const memberships = [admin('only')];
    expect(selectEffectiveWorkspaceId(memberships)).toBe('only');
    expect(selectEffectiveWorkspaceId(memberships, 'other')).toBe('only');
    expect(selectEffectiveWorkspaceId(memberships, 'only')).toBe('only');
  });
});
