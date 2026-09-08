/**
 * The outreach workbench against the database (docs/outreach-workbench.md):
 * prospects are created and imported, a draft is made from the evidence and
 * the argument accumulates, "sent" freezes what went out, the record and the
 * lessons reach the next draft, and nothing here ever sends anything.
 */
jest.mock('../db/client', () => require('./harness/test-db'));

import {
  askOutreach,
  createProspect,
  draftMessage,
  getLessons,
  importProspects,
  listProspects,
  setLessons,
  updateProspect,
} from '../services/outreach';
import { ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

function mockFetch(reply: (url: string) => unknown) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  global.fetch = jest.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => reply(String(url)) } as any;
  }) as any;
  return calls;
}

function mockAnthropic(input: unknown, name = 'draft') {
  return mockFetch(() => ({ content: [{ type: 'tool_use', name, input }] }));
}

const key = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  process.env.ANTHROPIC_API_KEY = key;
});

describe('prospects', () => {
  test('create, list in position order, update, and the list carries the summary', async () => {
    const a = await createProspect({
      name: 'Rob Hallam',
      company: 'SuperX',
      segment: 'B',
      channel: 'x',
      handle: '@robj3d3',
    });
    const b = await createProspect({
      name: 'Ryan Carson',
      segment: 'A',
      channel: 'x',
      handle: 'ryancarson',
      position: -1,
    });
    const { prospects, summary } = await listProspects();
    expect(prospects.map(p => p.name)).toEqual(['Ryan Carson', 'Rob Hallam']);
    expect(summary.sent).toBe(0);
    expect(b.status).toBe('draft');

    const updated = await updateProspect(a.id, { message: 'Hey Rob.', day: 'D1', status: 'ready' });
    expect(updated.message).toBe('Hey Rob.');
    expect(updated.status).toBe('ready');
    expect(updated.sentAt).toBeNull();
  });

  test('import takes many at once and returns the count; a bad row fails the whole import', async () => {
    const n = await importProspects([
      { name: 'A', channel: 'x', handle: 'a' },
      { name: 'B', channel: 'email', handle: 'b@c.d', evidence: 'runs a thing' },
    ]);
    expect(n).toBe(2);
    const { prospects } = await listProspects();
    expect(prospects.map(p => p.name)).toEqual(['A', 'B']);
    expect(prospects[1].evidence).toBe('runs a thing');

    await expect(importProspects([{ name: 'C' }, { channel: 'x' } as any])).rejects.toThrow(/name/);
    expect((await listProspects()).prospects).toHaveLength(2);
  });

  test('marking a prospect sent freezes the text and the time, and a later edit does not touch them', async () => {
    const p = await createProspect({ name: 'A', channel: 'x', handle: 'a', message: 'Hey, want it?' });
    const sent = await updateProspect(p.id, { status: 'sent' });
    expect(sent.sentText).toBe('Hey, want it?');
    expect(sent.sentAt).toBeInstanceOf(Date);

    const later = await updateProspect(p.id, { message: 'something else', status: 'replied', outcome: 'yes' });
    expect(later.sentText).toBe('Hey, want it?');
    expect(later.sentAt?.getTime()).toBe(sent.sentAt?.getTime());
    expect(later.outcome).toBe('yes');
  });

  test('a prospect cannot be marked sent with no message: there is nothing to have sent', async () => {
    const p = await createProspect({ name: 'A', channel: 'x', handle: 'a' });
    await expect(updateProspect(p.id, { status: 'sent' })).rejects.toThrow(/message/);
  });

  test('updating a prospect that does not exist is a 404, not a silent no-op', async () => {
    await expect(updateProspect('nope', { message: 'x' })).rejects.toThrow(/No such prospect/);
  });
});

describe('draftMessage', () => {
  test('the draft comes from the evidence, in his voice, and the argument accumulates', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    await setLessons('X DMs that led with their number got replies.');
    const p = await createProspect({
      name: 'Rob Hallam',
      company: 'SuperX',
      segment: 'B',
      channel: 'x',
      handle: '@robj3d3',
      evidence: 'SuperX $19,195 MRR, down from $23k in February (TrustMRR 2026-09-07). Price fixed at $39.',
    });
    const calls = mockAnthropic({
      text: 'Hey Rob, Viktor here. SuperX went $23k to $19k. Decided on the price yet? Want a floor?',
      answer: 'Led with the number he published.',
    });
    const first = await draftMessage(p.id, []);
    expect(first).toEqual({
      message: 'Hey Rob, Viktor here. SuperX went $23k to $19k. Decided on the price yet? Want a floor?',
      answer: 'Led with the number he published.',
    });
    // The evidence and the lessons reach the model; the tool is offered.
    expect(calls[0].body.messages[0].content).toContain('$19,195 MRR');
    expect(calls[0].body.system).toContain('led with their number got replies');
    expect(calls[0].body.tools[0].name).toBe('draft');

    // A push-back carries the whole argument.
    const turns = [
      { role: 'assistant' as const, content: JSON.stringify(first) },
      { role: 'user' as const, content: 'shorter' },
    ];
    mockAnthropic({ text: 'Hey Rob, $23k to $19k. Want a floor on it?', answer: 'Cut the question.' });
    const second = await draftMessage(p.id, turns);
    expect(second.message).toBe('Hey Rob, $23k to $19k. Want a floor on it?');
    const sent = (global.fetch as jest.Mock).mock.calls.at(-1)?.[1];
    const body = JSON.parse(sent.body);
    expect(body.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(body.messages.at(-1).content).toBe('shorter');

    // The turns are kept on the row, so reopening the prospect shows the argument.
    const { prospects } = await listProspects();
    expect(prospects[0].conversation).toHaveLength(3);
    expect(prospects[0].message).toBe('Hey Rob, $23k to $19k. Want a floor on it?');
  });

  test('a dash in the draft becomes a comma before he sees it', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    const p = await createProspect({ name: 'A', channel: 'x', handle: 'a', evidence: 'x' });
    mockAnthropic({ text: 'Hey A — want it?', answer: 'ok' });
    expect((await draftMessage(p.id, [])).message).toBe('Hey A, want it?');
  });

  test('the record of what was sent and what came back reaches the next draft', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    const done = await createProspect({
      name: 'Earlier Person',
      segment: 'A',
      channel: 'x',
      handle: 'e',
      message: 'Hey, Viktor here. Have you decided on the 1.0 date? Want a floor on the $8k?',
    });
    await updateProspect(done.id, { status: 'sent' });
    await updateProspect(done.id, { status: 'replied', outcome: 'said yes, call Tuesday' });
    const p = await createProspect({ name: 'Next Person', segment: 'A', channel: 'x', handle: 'n', evidence: 'y' });
    const calls = mockAnthropic({ text: 'Hey.', answer: 'ok' });
    await draftMessage(p.id, []);
    expect(calls[0].body.system).toContain('Earlier Person');
    expect(calls[0].body.system).toContain('said yes, call Tuesday');
    expect(calls[0].body.system).toMatch(/Do not copy/);
  });

  test('without a drafting key it is a 503 that says which key, never an empty draft', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const p = await createProspect({ name: 'A', channel: 'x', handle: 'a' });
    await expect(draftMessage(p.id, [])).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  test('drafting for a prospect that does not exist is a 404', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    await expect(draftMessage('nope', [])).rejects.toThrow(/No such prospect/);
  });
});

describe('askOutreach', () => {
  test('answers from the record and the lessons; an empty question is refused', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    await setLessons('Email was dead.');
    const calls = mockAnthropic({ answer: 'Push segment A: 3 of 4 replied.' }, 'answer');
    const r = await askOutreach([{ role: 'user', content: 'which segment should I push?' }]);
    expect(r.answer).toBe('Push segment A: 3 of 4 replied.');
    expect(calls[0].body.system).toContain('Email was dead.');
    await expect(askOutreach([])).rejects.toThrow(/Ask something/);
  });
});

describe('lessons', () => {
  test('empty until written; a put replaces', async () => {
    expect(await getLessons()).toBe('');
    await setLessons('one');
    await setLessons('two');
    expect(await getLessons()).toBe('two');
  });
});
