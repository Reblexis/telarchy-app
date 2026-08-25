import type { NextFunction, Request, Response } from 'express';
import { requireCapability } from '../middleware/roles';
import type { AuthInfo, Capability } from '../types';

/**
 * Synthetic Request/Response, same approach as require-scope.test.ts: stub only
 * the auth-relevant fields and status/json so we can assert what the middleware
 * did without booting Express.
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

describe('requireCapability', () => {
  test('401 when there is no auth at all', () => {
    const { res, status, json } = makeRes();
    const next = jest.fn();
    requireCapability('read')(makeReq(undefined), res, next as NextFunction);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  test('passes through when the caller holds the required capability', () => {
    const { res, status } = makeRes();
    const next = jest.fn();
    requireCapability('read')(makeReq({ capabilities: new Set<Capability>(['read']) }), res, next as NextFunction);
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes through when the caller holds any one of several required capabilities', () => {
    const { res, status } = makeRes();
    const next = jest.fn();
    requireCapability('manage', 'trade')(
      makeReq({ capabilities: new Set<Capability>(['trade']) }),
      res,
      next as NextFunction,
    );
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('403 names the single missing capability and echoes requiredCapabilities', () => {
    const { res, status, json } = makeRes();
    const next = jest.fn();
    requireCapability('read')(
      makeReq({ agentId: 'a1', capabilities: new Set<Capability>() }),
      res,
      next as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('"read"'),
        requiredCapabilities: ['read'],
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('403 lists all options when multiple capabilities would satisfy the gate', () => {
    const { res, status, json } = makeRes();
    const next = jest.fn();
    requireCapability('manage', 'trade')(
      makeReq({ agentId: 'a1', capabilities: new Set<Capability>(['read']) }),
      res,
      next as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('manage, trade'),
        requiredCapabilities: ['manage', 'trade'],
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
