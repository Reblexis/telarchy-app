import type { NextFunction, Request, Response } from 'express';
import { requireScope } from '../middleware/roles';
import type { AuthInfo, Capability } from '../types';

/**
 * Synthetic Request/Response. We only stub the auth-relevant fields and the
 * status/json methods so we can assert what the middleware did without booting
 * Express.
 */
function makeReq(auth?: Partial<AuthInfo>): Request {
  const r: Partial<Request> & { auth?: AuthInfo } = {};
  if (auth) {
    r.auth = {
      capabilities: new Set<Capability>(),
      workspaceId: 'ws',
      ...auth,
    };
  }
  return r as Request;
}

function makeRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

describe('requireScope', () => {
  test('401 when there is no auth at all', () => {
    const { res, status, json } = makeRes();
    const next = jest.fn();
    requireScope('account:read')(makeReq(undefined), res, next as NextFunction);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  test('passes through for browser sessions regardless of scope (uid is set)', () => {
    const { res, status } = makeRes();
    const next = jest.fn();
    requireScope('account:wallet')(makeReq({ uid: 'user-123' }), res, next as NextFunction);
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes through for the master API key regardless of scope', () => {
    const { res, status } = makeRes();
    const next = jest.fn();
    requireScope('account:keys')(makeReq({ isMasterKey: true }), res, next as NextFunction);
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes through for an agent-key caller whose scopes include the wildcard', () => {
    const { res, status } = makeRes();
    const next = jest.fn();
    requireScope('account:wallet')(makeReq({ agentId: 'a1', scopes: ['*'] }), res, next as NextFunction);
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes through for an agent-key caller whose scopes include the named scope', () => {
    const { res, status } = makeRes();
    const next = jest.fn();
    requireScope('account:keys')(
      makeReq({ agentId: 'a1', scopes: ['workspace:read', 'account:keys'] }),
      res,
      next as NextFunction,
    );
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('403 with a useful message when the agent key is missing the scope', () => {
    const { res, status, json } = makeRes();
    const next = jest.fn();
    requireScope('account:wallet')(makeReq({ agentId: 'a1', scopes: ['workspace:read'] }), res, next as NextFunction);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('account:wallet') }));
    expect(next).not.toHaveBeenCalled();
  });

  test('403 when the agent key has no scopes at all (defensive default)', () => {
    // This shouldn't happen in practice (every row has scopes), but the
    // middleware must fail closed if it ever does.
    const { res, status } = makeRes();
    const next = jest.fn();
    requireScope('account:read')(makeReq({ agentId: 'a1', scopes: undefined }), res, next as NextFunction);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('an agent-key caller that holds the wildcard but not the named scope still passes (wildcard means everything)', () => {
    const { res, status } = makeRes();
    const next = jest.fn();
    requireScope('account:agents')(makeReq({ agentId: 'a1', scopes: ['*'] }), res, next as NextFunction);
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
