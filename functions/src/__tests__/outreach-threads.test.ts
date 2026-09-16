/**
 * Threads, the agent's fields and the agent learnings
 * (docs/outreach-workbench.md, "The prospect", "Threads", "The overnight
 * agent"). The rule these protect is the owner's: approval is the only thing
 * that authorises a send, so nothing an agent writes can arrive approved, and
 * what went out can never be rewritten.
 */
jest.mock('../db/client', () => require('./harness/test-db'));

import {
  addThreadMessage,
  createProspect,
  deleteProspect,
  getLearnings,
  getLessons,
  importProspects,
  listProspects,
  setLearnings,
  setLessons,
  summariseOutreach,
  updateProspect,
  updateThreadMessage,
} from '../services/outreach';
import { ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const sentProspect = async (name = 'A') => {
  const p = await createProspect({ name, channel: 'x', handle: name.toLowerCase(), message: 'first' });
  return updateProspect(p.id, { status: 'sent' });
};

describe('a prospect never arrives approved', () => {
  test('creating a prospect as approved is refused', async () => {
    await expect(createProspect({ name: 'A', channel: 'x', message: 'x', status: 'approved' })).rejects.toThrow(
      /approved/,
    );
  });

  test('importing a prospect as approved is refused, and nothing of that import lands', async () => {
    await expect(
      importProspects([
        { name: 'Fine', channel: 'x', message: 'x', status: 'ready' },
        { name: 'Sneaky', channel: 'x', message: 'x', status: 'approved' },
      ]),
    ).rejects.toThrow(/approved/);
    expect((await listProspects()).prospects).toHaveLength(0);
  });

  test('the owner can still approve an existing row', async () => {
    const p = await createProspect({ name: 'A', channel: 'x', message: 'x', status: 'ready' });
    expect((await updateProspect(p.id, { status: 'approved' })).status).toBe('approved');
  });
});

describe('the agent fields on a prospect', () => {
  test('variant, reasoning and source are kept; source defaults to owner', async () => {
    const mine = await createProspect({ name: 'Mine', channel: 'x' });
    expect(mine.source).toBe('owner');
    const agents = await createProspect({
      name: 'Theirs',
      channel: 'x',
      status: 'ready',
      message: 'hi',
      variant: 'decision-hook',
      reasoning: 'Posted about raising prices twice this month.',
      source: 'agent',
    });
    expect(agents).toMatchObject({ variant: 'decision-hook', source: 'agent' });
    expect(agents.reasoning).toMatch(/raising prices/);
  });

  test('an unknown source is refused', async () => {
    await expect(createProspect({ name: 'A', channel: 'x', source: 'robot' })).rejects.toThrow(/source/);
  });

  test('skipped is a status, and a skipped row counts as nothing sent', async () => {
    const p = await createProspect({ name: 'A', channel: 'x', message: 'x', status: 'ready' });
    const skipped = await updateProspect(p.id, { status: 'skipped' });
    expect(skipped.status).toBe('skipped');
    expect(skipped.sentAt).toBeNull();
    expect((await listProspects()).summary.sent).toBe(0);
  });
});

describe('an out message is created draft whatever the request says', () => {
  test('asking for approved or sent on creation still gives a draft with no sentAt', async () => {
    const p = await sentProspect();
    for (const status of ['approved', 'sent']) {
      const m = await addThreadMessage(p.id, { direction: 'out', text: `follow-up ${status}`, status });
      expect(m.status).toBe('draft');
      expect(m.sentAt).toBeNull();
    }
  });

  test('an out message keeps its variant and reasoning', async () => {
    const p = await sentProspect();
    const m = await addThreadMessage(p.id, {
      direction: 'out',
      text: 'It is $300 for four weeks on one decision.',
      variant: 'price-after-yes',
      reasoning: 'They said yes to a floor.',
    });
    expect(m).toMatchObject({ direction: 'out', variant: 'price-after-yes', reasoning: 'They said yes to a floor.' });
  });

  test('a message needs text, a known direction and an existing prospect', async () => {
    const p = await sentProspect();
    await expect(addThreadMessage(p.id, { direction: 'out', text: '  ' })).rejects.toThrow(/text/);
    await expect(addThreadMessage(p.id, { direction: 'sideways', text: 'x' })).rejects.toThrow(/direction/);
    await expect(addThreadMessage('nope', { direction: 'in', text: 'x' })).rejects.toThrow(/prospect/i);
  });
});

describe('a reply is recorded once, however often the thread is read', () => {
  test('an in message is received, and the same text on the same prospect is the same message', async () => {
    const p = await sentProspect();
    const first = await addThreadMessage(p.id, { direction: 'in', text: 'sounds interesting, how much?' });
    const again = await addThreadMessage(p.id, { direction: 'in', text: 'sounds interesting, how much?' });
    expect(first.status).toBe('received');
    expect(again.id).toBe(first.id);
    const { prospects } = await listProspects();
    expect(prospects[0].thread).toHaveLength(1);
  });

  test('a reply read twice with different spacing is recorded once', async () => {
    const p = await sentProspect();
    const first = await addThreadMessage(p.id, { direction: 'in', text: 'yes, how much?' });
    const again = await addThreadMessage(p.id, { direction: 'in', text: '  yes,  how\nmuch? ' });
    expect(again.id).toBe(first.id);
    expect((await listProspects()).prospects[0].thread).toHaveLength(1);
  });

  test('different words from the same person are two replies', async () => {
    const p = await sentProspect();
    await addThreadMessage(p.id, { direction: 'in', text: 'yes' });
    await addThreadMessage(p.id, { direction: 'in', text: 'yes please' });
    expect((await listProspects()).prospects[0].thread).toHaveLength(2);
  });

  test('two callers recording the same reply at once still leave one message', async () => {
    const p = await sentProspect();
    const [a, b] = await Promise.all([
      addThreadMessage(p.id, { direction: 'in', text: 'yes' }),
      addThreadMessage(p.id, { direction: 'in', text: 'yes' }),
    ]);
    expect(a.id).toBe(b.id);
    expect((await listProspects()).prospects[0].thread).toHaveLength(1);
  });

  test('the first reply moves a sent prospect to replied', async () => {
    const p = await sentProspect();
    await addThreadMessage(p.id, { direction: 'in', text: 'hi' });
    expect((await listProspects()).prospects[0].status).toBe('replied');
  });

  test('a reply leaves a later status the owner set alone', async () => {
    const p = await sentProspect();
    await updateProspect(p.id, { status: 'call' });
    await addThreadMessage(p.id, { direction: 'in', text: 'see you tuesday' });
    expect((await listProspects()).prospects[0].status).toBe('call');
  });
});

describe('what went out in a thread can never be rewritten', () => {
  test('draft to approved to sent stamps sentAt once', async () => {
    const p = await sentProspect();
    const m = await addThreadMessage(p.id, { direction: 'out', text: 'follow-up' });
    const approved = await updateThreadMessage(m.id, { status: 'approved' });
    expect(approved.status).toBe('approved');
    expect(approved.sentAt).toBeNull();
    const sent = await updateThreadMessage(m.id, { status: 'sent' });
    const stamp = sent.sentAt?.getTime();
    expect(stamp).toBeGreaterThan(0);
    const again = await updateThreadMessage(m.id, { status: 'sent' });
    expect(again.sentAt?.getTime()).toBe(stamp);
  });

  test('editing the text of a sent message is refused', async () => {
    const p = await sentProspect();
    const m = await addThreadMessage(p.id, { direction: 'out', text: 'what went out' });
    await updateThreadMessage(m.id, { status: 'sent' });
    await expect(updateThreadMessage(m.id, { text: 'something nicer' })).rejects.toThrow(/sent/);
    expect((await listProspects()).prospects[0].thread[0].text).toBe('what went out');
  });

  test('a draft can be edited and skipped', async () => {
    const p = await sentProspect();
    const m = await addThreadMessage(p.id, { direction: 'out', text: 'rough' });
    expect((await updateThreadMessage(m.id, { text: 'better' })).text).toBe('better');
    expect((await updateThreadMessage(m.id, { status: 'skipped' })).status).toBe('skipped');
  });

  test('an in message cannot be approved or sent, and unknown statuses are refused', async () => {
    const p = await sentProspect();
    const inbound = await addThreadMessage(p.id, { direction: 'in', text: 'hello' });
    await expect(updateThreadMessage(inbound.id, { status: 'approved' })).rejects.toThrow(/status/);
    const out = await addThreadMessage(p.id, { direction: 'out', text: 'x' });
    await expect(updateThreadMessage(out.id, { status: 'received' })).rejects.toThrow(/status/);
    await expect(updateThreadMessage(out.id, { status: 'whatever' })).rejects.toThrow(/status/);
  });

  test('an unknown message is a 404', async () => {
    await expect(updateThreadMessage('nope', { status: 'approved' })).rejects.toThrow(/message/i);
  });
});

describe('the list carries each thread', () => {
  test('oldest first by when it happened, and a prospect with none has an empty thread', async () => {
    const p = await sentProspect('A');
    await createProspect({ name: 'B', channel: 'x' });
    await addThreadMessage(p.id, { direction: 'out', text: 'second', at: '2026-09-15T10:00:00Z' });
    await addThreadMessage(p.id, { direction: 'in', text: 'first', at: '2026-09-15T09:00:00Z' });
    const { prospects } = await listProspects();
    expect(prospects.find(x => x.name === 'A')?.thread.map(m => m.text)).toEqual(['first', 'second']);
    expect(prospects.find(x => x.name === 'B')?.thread).toEqual([]);
  });

  test('removing a prospect removes its thread', async () => {
    const p = await sentProspect();
    await addThreadMessage(p.id, { direction: 'in', text: 'hi' });
    await deleteProspect(p.id);
    const q = await sentProspect('B');
    expect((await listProspects()).prospects.map(x => x.id)).toEqual([q.id]);
  });
});

describe("agent learnings are the agent's, apart from the owner's lessons", () => {
  test('writing learnings never touches lessons, and the reverse', async () => {
    await setLessons('mine');
    await setLearnings('what variant decision-hook got');
    expect(await getLessons()).toBe('mine');
    expect(await getLearnings()).toBe('what variant decision-hook got');
    await setLessons('mine, revised');
    expect(await getLearnings()).toBe('what variant decision-hook got');
  });

  test('learnings start empty', async () => {
    expect(await getLearnings()).toBe('');
  });
});

describe('the summary compares first messages by variant', () => {
  const row = (variant: string | null, status: string) => ({
    segment: 'A',
    channel: 'x',
    status,
    sentText: 'Hey, one question.',
    variant,
  });

  test('from ten sent, sent and answered per variant, an unlabelled one as ?', () => {
    const rows = [
      ...Array.from({ length: 4 }, () => row('decision-hook', 'sent')),
      row('decision-hook', 'replied'),
      ...Array.from({ length: 4 }, () => row('privacy-first', 'sent')),
      row(null, 'no'),
      row('privacy-first', 'approved'),
    ];
    const s = summariseOutreach(rows);
    if (!s.enough) throw new Error('ten went out');
    expect(s.byVariant).toEqual([
      { key: '?', sent: 1, replied: 1 },
      { key: 'decision-hook', sent: 5, replied: 1 },
      { key: 'privacy-first', sent: 4, replied: 0 },
    ]);
  });
});
