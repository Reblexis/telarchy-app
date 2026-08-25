/**
 * Otto acts with the caller's own credentials, and holds none of his own
 * (owner direction 2026-08-21: "exact same access the given user has").
 *
 * The failure this pins is the one that would matter: a tool that quietly
 * carried a service credential, or dropped the caller's, would make Otto
 * either more powerful than the person talking to him or less. Both are
 * silent, because the model would happily narrate a plausible answer either
 * way. So the test reads the request the tool actually sends.
 */

import type { Request } from 'express';
import express from 'express';
import type { Server } from 'http';
import { type ApiCallRecord, ottoApiTools } from '../services/otto-tools';

/** A stand-in for the API this process serves: it answers with the headers it
 *  received, so the test can assert on identity rather than on behaviour. */
let server: Server;
let seen: Array<{ method: string; url: string; headers: Record<string, unknown>; body: unknown }> = [];
let reply: { status: number; body: unknown } = { status: 200, body: { ok: true } };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: req.body });
    res.status(reply.status).json(reply.body);
  });
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, (err?: Error) => (err ? reject(err) : resolve()));
  });
  const port = (server.address() as { port: number }).port;
  process.env.SELF_BASE_URL = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  delete process.env.SELF_BASE_URL;
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  reply = { status: 200, body: { ok: true } };
});

/** The parts of an Express request these tools read. */
function fakeReq(headers: Record<string, string>, agentId: string | null): Request {
  return {
    headers,
    socket: { remoteAddress: '203.0.113.7' },
    auth: agentId ? { agentId } : null,
  } as unknown as Request;
}

function callTool(tools: ReturnType<typeof ottoApiTools>) {
  const t = tools.find(x => x.spec.function.name === 'call_api')!;
  return t;
}

test("the call carries the caller's own credentials, and no others", async () => {
  const record: ApiCallRecord[] = [];
  const tools = ottoApiTools(
    fakeReq(
      {
        cookie: 'session=abc',
        'x-workspace-id': 'ws-1',
        'user-agent': 'Mozilla/5.0',
      },
      'agent-7',
    ),
    record,
  );

  await callTool(tools).run({ method: 'POST', path: '/api/predictions/trade', body: { amount: 25 } });

  expect(seen).toHaveLength(1);
  expect(seen[0].method).toBe('POST');
  expect(seen[0].url).toBe('/api/predictions/trade');
  expect(seen[0].body).toEqual({ amount: 25 });
  // The visitor's identity, forwarded verbatim.
  expect(seen[0].headers.cookie).toBe('session=abc');
  expect(seen[0].headers['x-workspace-id']).toBe('ws-1');
  // Their address, so a per-IP limit counts against them and not against the
  // loopback interface every visitor would otherwise share.
  expect(seen[0].headers['x-forwarded-for']).toBe('203.0.113.7');
  // Nothing else of theirs travels, and nothing of ours: no master key, no
  // agent key of Otto's, because he does not have one.
  expect(seen[0].headers['x-api-key']).toBeUndefined();
  expect(seen[0].headers['user-agent']).not.toBe('Mozilla/5.0');
});

test('an anonymous asker sends an anonymous request', async () => {
  const record: ApiCallRecord[] = [];
  const tools = ottoApiTools(fakeReq({}, null), record);
  await callTool(tools).run({ method: 'GET', path: '/api/marketplace/stats' });

  expect(seen[0].headers.cookie).toBeUndefined();
  expect(seen[0].headers.authorization).toBeUndefined();
  expect(seen[0].headers['x-api-key']).toBeUndefined();
  // And he is told, in the tool description, that acting will fail for them:
  // it is the difference between a useful answer and a pretended one.
  expect(callTool(tools).spec.function.description).toMatch(/not signed in/i);
});

test('a refusal comes back as the status, not as a summary', async () => {
  reply = { status: 403, body: { error: 'Not a member' } };
  const record: ApiCallRecord[] = [];
  const tools = ottoApiTools(fakeReq({ cookie: 'session=abc' }, 'agent-7'), record);

  const out = await callTool(tools).run({ method: 'POST', path: '/api/proposals', body: {} });
  expect(out).toContain('HTTP 403');
  expect(out).toContain('Not a member');
  // A 403 is a fact about this person's permissions, and it is recorded.
  expect(record).toEqual([{ method: 'POST', path: '/api/proposals', status: 403 }]);
});

test('everything he does is recorded, in order', async () => {
  const record: ApiCallRecord[] = [];
  const tools = ottoApiTools(fakeReq({ cookie: 'session=abc' }, 'agent-7'), record);
  await callTool(tools).run({ method: 'GET', path: '/api/agents/me/dashboard' });
  await callTool(tools).run({ method: 'POST', path: '/api/predictions/trade', body: { amount: 5 } });

  expect(record).toEqual([
    { method: 'GET', path: '/api/agents/me/dashboard', status: 200 },
    { method: 'POST', path: '/api/predictions/trade', status: 200 },
  ]);
});

test('it refuses to leave the API, whatever the model asks for', async () => {
  const record: ApiCallRecord[] = [];
  const tools = ottoApiTools(fakeReq({ cookie: 'session=abc' }, 'agent-7'), record);

  for (const path of ['https://example.com/steal', '/admin', '/api/../etc/passwd']) {
    const out = await callTool(tools).run({ method: 'GET', path });
    expect(out).toMatch(/^Refused/);
  }
  expect(await callTool(tools).run({ method: 'TRACE', path: '/api/status' })).toMatch(/^Refused/);
  expect(seen).toHaveLength(0);
  expect(record).toHaveLength(0);
});

test('find_endpoint answers from the catalog the API actually serves', async () => {
  const record: ApiCallRecord[] = [];
  const tools = ottoApiTools(fakeReq({}, null), record);
  const finder = tools.find(t => t.spec.function.name === 'find_endpoint')!;

  const out = await finder.run({ query: 'data room' });
  expect(out).toContain('/api/data-room');
  // A miss says so rather than inventing a path for him to call.
  expect(await finder.run({ query: 'zzzz nothing like this' })).toMatch(/No endpoint matches/);
});

test('an anonymous question about this floor still reads this floor', async () => {
  // Reading a public workspace needs no key but does need to name the
  // workspace, and a browser visitor sends no such header. Without the floor
  // being passed through, an anonymous "what does the market say" came back
  // 401 and Otto correctly but uselessly reported it.
  const record: ApiCallRecord[] = [];
  const tools = ottoApiTools(fakeReq({}, null), record, 'ws-lookpilot');
  await callTool(tools).run({ method: 'GET', path: '/api/predictions/markets' });
  expect(seen[0].headers['x-workspace-id']).toBe('ws-lookpilot');
});

test("the caller's own workspace wins over the floor they are standing on", async () => {
  const record: ApiCallRecord[] = [];
  const tools = ottoApiTools(fakeReq({ 'x-workspace-id': 'ws-mine' }, 'agent-7'), record, 'ws-lookpilot');
  await callTool(tools).run({ method: 'GET', path: '/api/predictions/markets' });
  expect(seen[0].headers['x-workspace-id']).toBe('ws-mine');
});
