import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * "Waiting for you" (docs/outreach-workbench.md, "Waiting for you"): the tab
 * opens on every first message in `ready` and every follow-up in `draft`,
 * each with who, the variant, the message, the reasoning and the evidence;
 * Approve saves the edit and approves, Skip skips, and nothing is sent. The
 * agent learnings are shown apart from the owner's lessons.
 */
vi.mock('../../lib/api', () => ({
  api: {
    outreachProspects: vi.fn(),
    outreachCreate: vi.fn(),
    outreachImport: vi.fn(),
    outreachUpdate: vi.fn(),
    outreachUpdateMessage: vi.fn(),
    outreachDelete: vi.fn(),
    outreachDraft: vi.fn(),
    outreachAsk: vi.fn(),
    outreachGetLessons: vi.fn(),
    outreachSetLessons: vi.fn(),
    outreachGetLearnings: vi.fn(),
  },
}));

import { api } from '../../lib/api';
import { OutreachWorkbench } from '../OutreachWorkbench';

const base = {
  company: null,
  segment: 'B',
  channel: 'x',
  conversation: [],
  day: null,
  outcome: null,
  sentText: null,
  sentAt: null,
  createdAt: '2026-09-15T00:00:00Z',
  updatedAt: '2026-09-15T00:00:00Z',
  logLine: '',
  thread: [],
  source: 'agent',
  variant: null,
  reasoning: null,
};

const jack = {
  ...base,
  id: 'p1',
  name: 'Jack Friks',
  company: 'Post Bridge',
  handle: '@jackfriks',
  link: 'https://x.com/jackfriks',
  evidence: 'Post Bridge listed for sale at about 3x ARR.',
  message: 'Hey Jack, Viktor here. Sell or keep compounding?',
  status: 'ready',
  position: 1,
  variant: 'decision-hook',
  reasoning: 'He posted the sale listing this week.',
};

const rob = {
  ...base,
  id: 'p2',
  name: 'Rob Hallam',
  handle: '@robj3d3',
  link: 'https://x.com/robj3d3',
  evidence: 'SuperX MRR.',
  message: 'Hey Rob, first message.',
  status: 'replied',
  sentText: 'Hey Rob, first message.',
  sentAt: '2026-09-09T05:30:08Z',
  position: 2,
  thread: [
    {
      id: 'm1',
      prospectId: 'p2',
      direction: 'in',
      text: 'maybe, what does it cost?',
      status: 'received',
      variant: null,
      reasoning: null,
      at: '2026-09-15T08:00:00Z',
      sentAt: null,
      createdAt: '2026-09-15T08:01:00Z',
    },
    {
      id: 'm2',
      prospectId: 'p2',
      direction: 'out',
      text: 'It is $300 for four weeks on one decision.',
      status: 'draft',
      variant: 'price-after-yes',
      reasoning: 'He asked the price.',
      at: null,
      sentAt: null,
      createdAt: '2026-09-15T08:02:00Z',
    },
  ],
};

const approvedAlready = {
  ...base,
  id: 'p3',
  name: 'Already Approved',
  handle: 'aa',
  link: '',
  evidence: '',
  message: 'ok',
  status: 'approved',
  position: 3,
};
const mineDraft = {
  ...base,
  id: 'p4',
  name: 'Mine In Draft',
  handle: 'md',
  link: '',
  evidence: '',
  message: 'wip',
  status: 'draft',
  position: 4,
  source: 'owner',
};

const list = (prospects: unknown[]) => ({
  prospects,
  summary: { enough: false as const, sent: 1, replied: 1, note: '1 sent, 1 answered.' },
  draftingConfigured: true,
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.outreachProspects).mockResolvedValue(list([jack, rob, approvedAlready, mineDraft]));
  mock(api.outreachGetLessons).mockResolvedValue({ lessons: 'my own lesson', draftingConfigured: true });
  mock(api.outreachGetLearnings).mockResolvedValue({ learnings: 'decision-hook: 0 of 4 answered so far' });
  mock(api.outreachUpdate).mockImplementation(async (id: string, input: Record<string, unknown>) => ({
    prospect: { ...jack, id, ...input },
  }));
  mock(api.outreachUpdateMessage).mockImplementation(async (id: string, input: Record<string, unknown>) => ({
    message: { ...rob.thread[1], id, ...input },
  }));
});

const waiting = async () => screen.findByRole('region', { name: /Waiting for you/ });

describe('waiting for you', () => {
  test('lists every ready first message and every draft follow-up, and nothing else', async () => {
    render(<OutreachWorkbench />);
    const box = await waiting();
    const cards = await within(box).findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(box).getByText(/Jack Friks/)).toBeInTheDocument();
    expect(within(box).getByText(/Rob Hallam/)).toBeInTheDocument();
    expect(within(box).queryByText(/Already Approved/)).toBeNull();
    expect(within(box).queryByText(/Mine In Draft/)).toBeNull();
    expect(within(box).getByRole('heading', { name: /Waiting for you \(2\)/ })).toBeInTheDocument();
  });

  test('a card shows the variant, the reasoning, the message, the evidence and where they read', async () => {
    render(<OutreachWorkbench />);
    const box = await waiting();
    const card = (await within(box).findAllByRole('article'))[0];
    expect(within(card).getByText('decision-hook')).toBeInTheDocument();
    expect(within(card).getByText(/posted the sale listing/)).toBeInTheDocument();
    expect(within(card).getByLabelText(/Message to Jack Friks/)).toHaveValue(jack.message);
    expect(within(card).getByText(/listed for sale at about 3x ARR/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /@jackfriks/ })).toHaveAttribute('href', 'https://x.com/jackfriks');
  });

  test('Approve saves the edited text and approves it, and sends nothing', async () => {
    render(<OutreachWorkbench />);
    const box = await waiting();
    const card = (await within(box).findAllByRole('article'))[0];
    fireEvent.change(within(card).getByLabelText(/Message to Jack Friks/), { target: { value: 'Hey Jack, edited.' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(api.outreachUpdate).toHaveBeenCalledWith('p1', { message: 'Hey Jack, edited.', status: 'approved' }),
    );
    expect(api.outreachUpdate).not.toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'sent' }));
  });

  test('Skip marks the prospect skipped', async () => {
    render(<OutreachWorkbench />);
    const card = (await within(await waiting()).findAllByRole('article'))[0];
    fireEvent.click(within(card).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(api.outreachUpdate).toHaveBeenCalledWith('p1', { status: 'skipped' }));
  });

  test('a follow-up shows the thread so far and Approve approves that message', async () => {
    render(<OutreachWorkbench />);
    const card = (await within(await waiting()).findAllByRole('article'))[1];
    expect(within(card).getByText(/what does it cost\?/)).toBeInTheDocument();
    expect(within(card).getByLabelText(/Message to Rob Hallam/)).toHaveValue(
      'It is $300 for four weeks on one decision.',
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(api.outreachUpdateMessage).toHaveBeenCalledWith('m2', {
        text: 'It is $300 for four weeks on one decision.',
        status: 'approved',
      }),
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(api.outreachUpdateMessage).toHaveBeenCalledWith('m2', { status: 'skipped' }));
  });

  test('nothing waiting says so', async () => {
    mock(api.outreachProspects).mockResolvedValue(list([approvedAlready]));
    render(<OutreachWorkbench />);
    const box = await waiting();
    expect(await within(box).findByText(/Nothing is waiting for you/)).toBeInTheDocument();
    expect(within(box).queryAllByRole('article')).toHaveLength(0);
  });
});

describe('the agent learnings', () => {
  test('are shown apart from the lessons, read-only', async () => {
    render(<OutreachWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: 'Agent learnings' }));
    const box = await screen.findByRole('region', { name: /Agent learnings/ });
    expect(within(box).getByText(/decision-hook: 0 of 4 answered/)).toBeInTheDocument();
    expect(within(box).queryByRole('textbox')).toBeNull();
    expect(within(box).queryByText(/my own lesson/)).toBeNull();
  });
});

describe('an opened prospect shows its thread', () => {
  test('their words and the follow-ups in order, each with its status', async () => {
    render(<OutreachWorkbench />);
    const list = await screen.findAllByRole('button', { name: /Rob Hallam/ });
    fireEvent.click(list[list.length - 1]);
    const thread = await screen.findByRole('list', { name: 'Thread' });
    const items = within(thread).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/them: maybe, what does it cost\?/);
    expect(items[1]).toHaveTextContent(/you, draft: It is \$300/);
  });
});
