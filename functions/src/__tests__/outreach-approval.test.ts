/**
 * Approval is what authorises a send, and nothing may be sent twice
 * (docs/outreach-workbench.md, "Who actually sends, and how it cannot send
 * twice"). Owner rule 2026-09-09: "make sure the skill marks what has
 * already been sent and doesnt sent a given outreach twice to the same
 * person", and "before sending a message it checks it hasnt sent yet".
 *
 * These pin the half an agent relies on: what `approved` means, that it is
 * not a send, and that a row which has gone can be recognised as gone.
 */
jest.mock('../db/client', () => require('./harness/test-db'));

import { createProspect, listProspects, summariseOutreach, updateProspect } from '../services/outreach';
import { ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

describe('approved is a permission, not an event', () => {
  test('approving stamps nothing and counts as nothing sent', async () => {
    const p = await createProspect({ name: 'A', channel: 'x', handle: 'a', message: 'Hey, one question.' });
    const approved = await updateProspect(p.id, { status: 'approved' });
    expect(approved.status).toBe('approved');
    expect(approved.sentAt).toBeNull();
    expect(approved.sentText).toBeNull();

    const { summary } = await listProspects();
    expect(summary.sent).toBe(0);
  });

  test('an approved row is the only thing an agent may send, and it is distinguishable', async () => {
    const draft = await createProspect({ name: 'Draft', channel: 'x', handle: 'd', message: 'x' });
    const ready = await createProspect({ name: 'Ready', channel: 'x', handle: 'r', message: 'x', status: 'ready' });
    const ok = await createProspect({ name: 'Approved', channel: 'x', handle: 'o', message: 'x' });
    await updateProspect(ok.id, { status: 'approved' });
    const gone = await createProspect({ name: 'Gone', channel: 'x', handle: 'g', message: 'x' });
    await updateProspect(gone.id, { status: 'sent' });

    const { prospects } = await listProspects();
    const sendable = prospects.filter(x => x.status === 'approved' && !x.sentAt);
    expect(sendable.map(x => x.name)).toEqual(['Approved']);
    expect(prospects.find(x => x.id === draft.id)?.status).toBe('draft');
    expect(prospects.find(x => x.id === ready.id)?.status).toBe('ready');
  });
});

describe('a message that has gone can never go twice', () => {
  test('sentAt survives a second move to sent, so a re-run cannot restamp it', async () => {
    const p = await createProspect({ name: 'A', channel: 'x', handle: 'a', message: 'first text' });
    const sent = await updateProspect(p.id, { status: 'sent' });
    const stamp = sent.sentAt?.getTime();
    expect(stamp).toBeGreaterThan(0);

    // An agent that lost its place and tried again, with the row edited since.
    const again = await updateProspect(p.id, { message: 'second text', status: 'sent' });
    expect(again.sentAt?.getTime()).toBe(stamp);
    expect(again.sentText).toBe('first text');
  });

  test('every state after sent still reads as sent, so a reply never re-opens the door', async () => {
    const p = await createProspect({ name: 'A', channel: 'x', handle: 'a', message: 'x' });
    await updateProspect(p.id, { status: 'sent' });
    for (const status of ['replied', 'call', 'workspace', 'activated', 'no']) {
      const row = await updateProspect(p.id, { status });
      expect(row.sentAt).not.toBeNull();
      expect(row.status).toBe(status);
    }
  });

  test('a row approved but never sent has no sentAt, which is the check an agent makes', async () => {
    const p = await createProspect({ name: 'A', channel: 'x', handle: 'a', message: 'x' });
    await updateProspect(p.id, { status: 'approved' });
    const { prospects } = await listProspects();
    expect(prospects[0].sentAt).toBeNull();
  });
});

describe('the summary counts what went out, not what was allowed to', () => {
  const row = (status: string) => ({ segment: 'A', channel: 'x', status, sentText: 'Hey, one question here.' });

  test('approved rows are not sent', () => {
    const s = summariseOutreach([row('approved'), row('approved'), row('ready'), row('sent')]);
    expect(s.sent).toBe(1);
  });
});
