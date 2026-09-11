jest.mock('../lib/public-read', () => ({ workspaceIdForName: async (id: string) => id }));
jest.mock('better-auth/node', () => ({ fromNodeHeaders: (h: any) => new Headers(h) }));
jest.mock('../auth', () => ({ auth: { api: { getSession: jest.fn(async () => ({ user: { id: 'owner' } })) } } }));
jest.mock('../db/client', () => ({
  db: { select: jest.fn(() => ({ from: () => ({ where: async () => [] }) })) },
  mirrorAccountIntoStore: jest.fn(),
}));
jest.mock('../lib/participants', () => ({
  selectEffectiveWorkspaceId: jest.fn(() => null),
  getUserWorkspaceMemberships: jest.fn(async () => []),
  getParticipantWorkspaceMemberships: jest.fn(async () => []),
}));
jest.mock('../middleware/capabilities', () => ({ computeCapabilities: jest.fn() }));

import { auth } from '../auth';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';

test.each([authMiddleware, optionalAuthMiddleware])(
  'an explicit invalid key never falls back to the owner session: %p',
  async middleware => {
    jest.clearAllMocks();
    const req = { headers: { cookie: 'session=owner', 'x-agent-key': 'invalid' }, query: {} } as any;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    await middleware(req, res, jest.fn());
    expect(auth.api.getSession).not.toHaveBeenCalled();
    expect(req.auth).toBeUndefined();
  },
);

test('a valid new bot key plus the owner cookie authenticates only the bot', async () => {
  const { db } = require('../db/client');
  db.select.mockReturnValueOnce({
    from: () => ({
      where: async () => [
        { agentId: 'bot', keyId: 'key', workspaceId: 'ws', scopes: ['workspace:read'], lastUsedAt: new Date() },
      ],
    }),
  });
  db.select.mockReturnValueOnce({ from: () => ({ where: async () => [{ id: 'bot' }] }) });
  const req = { headers: { cookie: 'session=owner', 'x-agent-key': 'valid' }, query: {} } as any;
  const next = jest.fn();
  await authMiddleware(req, {} as any, next);
  expect(req.auth.agentId).toBe('bot');
  expect(req.auth.uid).toBeUndefined();
  expect([...req.auth.capabilities]).toEqual([]);
  expect(next).toHaveBeenCalledTimes(1);
});
