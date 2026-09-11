/**
 * "What is planned" (docs/data-room.md, "What is planned"): the entries the
 * owner typed, and nothing derived. buildTimeline reads the plans table of
 * one floor and returns every entry, open ones first by due ascending with
 * the undated last, then the done ones by doneAt descending. It never reads
 * proposals or markets: a computed bar on the planned tab is a divergence,
 * whatever it is computed from (rule 5 of the doc).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, markets, metrics, plans, proposals, workspaces } from '../db/schema';
import { buildTimeline, sortTimelineItems, type TimelineItem } from '../services/timeline';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-tl';
const SLUG = 'timeline-ws';
const T = (s: string) => new Date(s);
const NOW = T('2026-09-11T12:00:00.000Z');

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed() {
  await db.insert(agents).values({ id: 'agent-tl', apiKeyHash: 'h-tl', balance: 0, nickname: 'owner' });
  await db
    .insert(workspaces)
    .values({ id: WS, name: 'Timeline WS', createdBy: 'agent-tl', visibility: 'public', slug: SLUG });
  await db.insert(metrics).values({ id: 'met-1', workspaceId: WS, name: 'Active forecasters' });
}

const items = () => buildTimeline(db, { id: WS, slug: SLUG }, NOW);

describe('a plan entry', () => {
  test('is returned whole: the words, both dates, open, and its three stamps', async () => {
    await seed();
    await db.insert(plans).values({
      id: 'pl-1',
      workspaceId: WS,
      title: 'Call with Seer',
      description: 'Thursday, about liquidity.',
      start: T('2026-09-15T09:00:00.000Z'),
      due: T('2026-09-17T14:00:00.000Z'),
      createdBy: 'agent-tl',
      createdAt: T('2026-09-10T08:00:00.000Z'),
      editedAt: T('2026-09-10T09:00:00.000Z'),
    });
    expect(await items()).toEqual([
      {
        id: 'pl-1',
        title: 'Call with Seer',
        description: 'Thursday, about liquidity.',
        start: '2026-09-15T09:00:00.000Z',
        due: '2026-09-17T14:00:00.000Z',
        done: false,
        createdAt: '2026-09-10T08:00:00.000Z',
        editedAt: '2026-09-10T09:00:00.000Z',
        doneAt: null,
      },
    ]);
  });

  test('a plan with no start, no due and no words carries nulls, not gaps', async () => {
    await seed();
    await db.insert(plans).values({ id: 'pl-1', workspaceId: WS, title: 'Someday' });
    const got = await items();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      start: null,
      due: null,
      description: null,
      done: false,
      editedAt: null,
      doneAt: null,
    });
    expect(Object.keys(got[0]).sort()).toEqual(
      ['createdAt', 'description', 'done', 'doneAt', 'due', 'editedAt', 'id', 'start', 'title'].sort(),
    );
  });

  test('a done plan is still an entry, marked done with its instant', async () => {
    await seed();
    await db.insert(plans).values({
      id: 'pl-1',
      workspaceId: WS,
      title: 'Done thing',
      due: T('2026-09-17T14:00:00.000Z'),
      doneAt: T('2026-09-11T10:00:00.000Z'),
    });
    const got = await items();
    expect(got).toHaveLength(1);
    expect(got[0].done).toBe(true);
    expect(got[0].doneAt).toBe('2026-09-11T10:00:00.000Z');
  });

  test("another floor's plans are not here", async () => {
    await seed();
    await db
      .insert(workspaces)
      .values({ id: 'ws-other', name: 'Other', createdBy: 'agent-tl', visibility: 'public', slug: 'other' });
    await db.insert(plans).values({ id: 'pl-x', workspaceId: 'ws-other', title: 'Not ours' });
    expect(await items()).toEqual([]);
  });

  test('an empty floor is an empty list', async () => {
    await seed();
    expect(await items()).toEqual([]);
  });
});

describe('THE PLANNED TAB HOLDS WHAT THE OWNER TYPED AND NOTHING DERIVED', () => {
  test('approved proposals, pending proposals and open books never become entries', async () => {
    await seed();
    await db.insert(proposals).values([
      {
        id: 'p-approved',
        number: 7,
        workspaceId: WS,
        proposedBy: 'agent-tl',
        title: 'Approved and undelivered',
        status: 'approved',
        createdAt: T('2026-09-01T10:00:00.000Z'),
        resolvedAt: T('2026-09-05T10:00:00.000Z'),
      },
      {
        id: 'p-pending',
        number: 8,
        workspaceId: WS,
        proposedBy: 'agent-tl',
        title: 'Pending with a deadline',
        status: 'pending',
        createdAt: T('2026-09-10T09:00:00.000Z'),
        decideBy: T('2026-09-12T09:00:00.000Z'),
      },
    ]);
    await db.insert(markets).values([
      {
        id: 'm-approved-branch',
        workspaceId: WS,
        metricId: 'met-1',
        metricName: 'Active forecasters',
        targetDate: '2026-10',
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0],
        liquidity: 10,
        pool: 10,
        proposalId: 'p-approved',
        branch: 'approved',
        settlesAt: T('2026-11-01T00:00:00.000Z'),
      },
      {
        id: 'm-baseline',
        workspaceId: WS,
        metricId: 'met-1',
        metricName: 'Active forecasters',
        targetDate: '2026-09',
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0],
        liquidity: 10,
        pool: 10,
        settlesAt: T('2026-10-01T00:00:00.000Z'),
      },
    ]);
    expect(await items()).toEqual([]);

    // With one typed entry beside them, the entry is the whole list.
    await db.insert(plans).values({ id: 'pl-1', workspaceId: WS, title: 'The one thing typed' });
    const got = await items();
    expect(got.map(i => i.id)).toEqual(['pl-1']);
    for (const it of got) expect(it).not.toHaveProperty('kind');
    for (const it of got) expect(it).not.toHaveProperty('href');
  });
});

describe('order', () => {
  const mk = (over: Partial<TimelineItem> & { id: string }): TimelineItem => ({
    title: over.id,
    description: null,
    start: null,
    due: null,
    done: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    editedAt: null,
    doneAt: null,
    ...over,
  });

  test('open entries by due ascending, undated last, then done entries by doneAt descending', () => {
    const sorted = sortTimelineItems([
      mk({ id: 'done-old', done: true, doneAt: '2026-09-02T00:00:00.000Z', due: '2026-09-01T00:00:00.000Z' }),
      mk({ id: 'undated-1' }),
      mk({ id: 'late', due: '2026-09-20T00:00:00.000Z' }),
      mk({ id: 'done-new', done: true, doneAt: '2026-09-09T00:00:00.000Z' }),
      mk({ id: 'soon', due: '2026-09-12T00:00:00.000Z' }),
      mk({ id: 'undated-2' }),
    ]);
    expect(sorted.map(i => i.id)).toEqual(['soon', 'late', 'undated-1', 'undated-2', 'done-new', 'done-old']);
  });

  test('ties on due keep the order they arrived in', () => {
    const sorted = sortTimelineItems([
      mk({ id: 'b', due: '2026-09-12T00:00:00.000Z' }),
      mk({ id: 'a', due: '2026-09-12T00:00:00.000Z' }),
    ]);
    expect(sorted.map(i => i.id)).toEqual(['b', 'a']);
  });

  test('buildTimeline returns the floor in that order', async () => {
    await seed();
    await db.insert(plans).values([
      { id: 'pl-undated', workspaceId: WS, title: 'Someday', createdAt: T('2026-09-01T00:00:00.000Z') },
      {
        id: 'pl-done-1',
        workspaceId: WS,
        title: 'Finished first',
        doneAt: T('2026-09-08T00:00:00.000Z'),
        createdAt: T('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'pl-late',
        workspaceId: WS,
        title: 'Later',
        due: T('2026-09-20T00:00:00.000Z'),
        createdAt: T('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'pl-done-2',
        workspaceId: WS,
        title: 'Finished second',
        doneAt: T('2026-09-10T00:00:00.000Z'),
        createdAt: T('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'pl-soon',
        workspaceId: WS,
        title: 'Soon',
        due: T('2026-09-11T18:00:00.000Z'),
        createdAt: T('2026-09-01T00:00:00.000Z'),
      },
    ]);
    expect((await items()).map(i => i.id)).toEqual(['pl-soon', 'pl-late', 'pl-undated', 'pl-done-2', 'pl-done-1']);
  });
});
