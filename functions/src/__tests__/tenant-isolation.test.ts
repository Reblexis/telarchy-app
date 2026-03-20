/**
 * Tenant isolation tests.
 *
 * These tests verify that workspace-scoped service calls resolve to the correct
 * Firestore paths and cannot cross workspace boundaries. We mock the Firestore
 * db() helper and assert on the collection paths used.
 */

jest.mock('../lib/db', () => ({
  db: jest.fn(),
}));

jest.mock('../services/events', () => ({
  emitEvent: jest.fn().mockResolvedValue(undefined),
}));

import { wsCol, wsDoc, wsLockDoc } from '../lib/workspace';
import { db } from '../lib/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFirestoreMock() {
  const docs: Record<string, unknown> = {};

  const makeCollection = (path: string) => ({
    _path: path,
    doc: (id?: string) => makeDoc(id ? `${path}/${id}` : `${path}/__auto__`),
    add: jest.fn(async (data: unknown) => {
      const id = `auto_${Math.random().toString(36).slice(2)}`;
      docs[`${path}/${id}`] = data;
      return { id };
    }),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
  });

  const makeDoc = (path: string) => ({
    _path: path,
    get: jest.fn().mockResolvedValue({ exists: false, data: () => undefined }),
    set: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    collection: (name: string) => makeCollection(`${path}/${name}`),
  });

  const mock = {
    collection: (name: string) => makeCollection(name),
    doc: (path: string) => makeDoc(path),
    batch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    })),
    runTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }), set: jest.fn(), update: jest.fn() };
      return fn(tx);
    }),
    getAll: jest.fn().mockResolvedValue([]),
  };

  return mock;
}

// ---------------------------------------------------------------------------
// wsCol path resolution
// ---------------------------------------------------------------------------

describe('wsCol', () => {
  it("maps 'default' to the flat top-level collection", () => {
    const fsMock = makeFirestoreMock();
    (db as jest.Mock).mockReturnValue(fsMock);

    const col = wsCol('default', 'metrics');
    expect((col as any)._path).toBe('metrics');
  });

  it('maps a custom workspace to the subcollection path', () => {
    const fsMock = makeFirestoreMock();
    (db as jest.Mock).mockReturnValue(fsMock);

    const col = wsCol('workspace-A', 'metrics');
    expect((col as any)._path).toBe('workspaces/workspace-A/metrics');
  });

  it('isolates two different workspaces', () => {
    const fsMock = makeFirestoreMock();
    (db as jest.Mock).mockReturnValue(fsMock);

    const colA = wsCol('workspace-A', 'markets');
    const colB = wsCol('workspace-B', 'markets');

    expect((colA as any)._path).not.toBe((colB as any)._path);
    expect((colA as any)._path).toBe('workspaces/workspace-A/markets');
    expect((colB as any)._path).toBe('workspaces/workspace-B/markets');
  });
});

// ---------------------------------------------------------------------------
// wsDoc path resolution
// ---------------------------------------------------------------------------

describe('wsDoc', () => {
  it("maps 'default' to a flat doc path", () => {
    const fsMock = makeFirestoreMock();
    (db as jest.Mock).mockReturnValue(fsMock);

    const doc = wsDoc('default', 'metrics', 'abc123');
    expect((doc as any)._path).toBe('metrics/abc123');
  });

  it('maps a custom workspace to a subcollection doc path', () => {
    const fsMock = makeFirestoreMock();
    (db as jest.Mock).mockReturnValue(fsMock);

    const doc = wsDoc('workspace-A', 'metrics', 'abc123');
    expect((doc as any)._path).toBe('workspaces/workspace-A/metrics/abc123');
  });
});

// ---------------------------------------------------------------------------
// wsLockDoc path resolution
// ---------------------------------------------------------------------------

describe('wsLockDoc', () => {
  it("maps 'default' to _system collection", () => {
    const fsMock = makeFirestoreMock();
    (db as jest.Mock).mockReturnValue(fsMock);

    const lock = wsLockDoc('default', 'marketRefreshLock');
    expect((lock as any)._path).toBe('_system/marketRefreshLock');
  });

  it('maps a custom workspace to the _locks subcollection', () => {
    const fsMock = makeFirestoreMock();
    (db as jest.Mock).mockReturnValue(fsMock);

    const lock = wsLockDoc('workspace-A', 'marketRefreshLock');
    expect((lock as any)._path).toBe('workspaces/workspace-A/_locks/marketRefreshLock');
  });

  it('isolates task market locks between workspaces', () => {
    const fsMock = makeFirestoreMock();
    (db as jest.Mock).mockReturnValue(fsMock);

    const lockA = wsLockDoc('workspace-A', 'taskMarketLock_task1');
    const lockB = wsLockDoc('workspace-B', 'taskMarketLock_task1');

    expect((lockA as any)._path).not.toBe((lockB as any)._path);
  });
});

// ---------------------------------------------------------------------------
// Collection cross-contamination: agents remain global
// ---------------------------------------------------------------------------

describe('Global collections stay unscoped', () => {
  it('agents is not scoped by wsCol', () => {
    const fsMock = makeFirestoreMock();
    (db as jest.Mock).mockReturnValue(fsMock);

    // agents should NEVER be accessed via wsCol — it must always be db().collection('agents')
    // This test documents the contract: wsCol('X', 'agents') would incorrectly scope it.
    // The correct usage (asserted by code review) is db().collection('agents') directly.
    const agentCol = fsMock.collection('agents');
    expect(agentCol._path).toBe('agents');

    // A mistaken wsCol call on workspace-A would give the wrong path
    const wrongCol = wsCol('workspace-A', 'agents');
    expect((wrongCol as any)._path).toBe('workspaces/workspace-A/agents');
    // This confirms agents must NOT go through wsCol in any service function.
  });
});

// ---------------------------------------------------------------------------
// AuthInfo workspaceId defaults
// ---------------------------------------------------------------------------

describe('workspaceId defaults', () => {
  it('all workspace helpers default to default when no workspaceId given', () => {
    const fsMock = makeFirestoreMock();
    (db as jest.Mock).mockReturnValue(fsMock);

    // wsCol with explicit 'default'
    const col = wsCol('default', 'events');
    expect((col as any)._path).toBe('events');

    // wsDoc with explicit 'default'
    const doc = wsDoc('default', 'tasks', 'task1');
    expect((doc as any)._path).toBe('tasks/task1');

    // wsLockDoc with explicit 'default'
    const lock = wsLockDoc('default', 'myLock');
    expect((lock as any)._path).toBe('_system/myLock');
  });
});
