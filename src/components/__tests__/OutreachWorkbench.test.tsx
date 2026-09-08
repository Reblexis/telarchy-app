import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The outreach workbench's load-bearing behaviours (docs/outreach-workbench.md):
 * a prospect opens with its evidence and message side by side, the argument
 * accumulates, "how to send it" is a link to where the person reads plus the
 * text on the clipboard, "I sent this" records without sending, and the
 * outcome is recorded in their words.
 */
vi.mock('../../lib/api', () => ({
  api: {
    outreachProspects: vi.fn(),
    outreachCreate: vi.fn(),
    outreachImport: vi.fn(),
    outreachUpdate: vi.fn(),
    outreachDelete: vi.fn(),
    outreachDraft: vi.fn(),
    outreachAsk: vi.fn(),
    outreachGetLessons: vi.fn(),
    outreachSetLessons: vi.fn(),
  },
}));

import { api } from '../../lib/api';
import { OutreachWorkbench } from '../OutreachWorkbench';

const rob = {
  id: 'p1',
  name: 'Rob Hallam',
  company: 'SuperX',
  segment: 'B',
  channel: 'x',
  handle: '@robj3d3',
  evidence: 'SuperX $19,195 MRR, down from $23k in February. Price fixed at $39.',
  message: 'Hey Rob, Viktor here. $23k to $19k. Want a floor on it?',
  conversation: [],
  status: 'draft',
  day: 'D1',
  outcome: null,
  sentText: null,
  sentAt: null,
  position: 1,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  link: 'https://x.com/robj3d3',
  logLine: '1. Rob Hallam (B), not sent yet via x. Answer: none yet. Floor: none.',
};

const list = (prospects = [rob]) => ({
  prospects,
  summary: { enough: false as const, sent: 0, replied: 0, note: '0 sent, 0 answered.' },
  draftingConfigured: true,
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.outreachProspects).mockResolvedValue(list());
  mock(api.outreachGetLessons).mockResolvedValue({ lessons: '', draftingConfigured: true });
  mock(api.outreachUpdate).mockImplementation(async (_id: string, input: Record<string, unknown>) => ({
    prospect: { ...rob, ...input },
  }));
});

describe('the outreach workbench', () => {
  test('lists the prospects and opens one with its evidence and message side by side', async () => {
    render(<OutreachWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Rob Hallam/ }));
    expect(screen.getByText(/19,195 MRR/)).toBeInTheDocument();
    expect(screen.getByLabelText(/The message you will send/)).toHaveValue(
      'Hey Rob, Viktor here. $23k to $19k. Want a floor on it?',
    );
  });

  test('how to send it: the channel link opens where they read and the text is copied, and nothing is sent', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OutreachWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Rob Hallam/ }));
    const open = screen.getByRole('link', { name: /Open x/ });
    expect(open).toHaveAttribute('href', 'https://x.com/robj3d3');
    expect(open).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    expect(writeText).toHaveBeenCalledWith('Hey Rob, Viktor here. $23k to $19k. Want a floor on it?');
    expect(api.outreachUpdate).not.toHaveBeenCalled();
  });

  test('"I sent this" records the send as a status change, with the text as edited', async () => {
    render(<OutreachWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Rob Hallam/ }));
    fireEvent.change(screen.getByLabelText(/The message you will send/), {
      target: { value: 'Hey Rob, Viktor here. Want a floor?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /I sent this/ }));
    await waitFor(() =>
      expect(api.outreachUpdate).toHaveBeenCalledWith('p1', {
        message: 'Hey Rob, Viktor here. Want a floor?',
        status: 'sent',
      }),
    );
  });

  test('the argument accumulates: a push-back carries the earlier turns', async () => {
    mock(api.outreachDraft)
      .mockResolvedValueOnce({ draft: { message: 'Hey Rob, first draft.', answer: 'Led with the number.' } })
      .mockResolvedValueOnce({ draft: { message: 'Hey Rob.', answer: 'Cut it.' } });
    render(<OutreachWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Rob Hallam/ }));
    fireEvent.click(screen.getByRole('button', { name: /Draft again/ }));
    await screen.findByText('Led with the number.');
    expect(screen.getByLabelText(/The message you will send/)).toHaveValue('Hey Rob, first draft.');

    fireEvent.change(screen.getByPlaceholderText(/Tell it what is wrong/), { target: { value: 'shorter' } });
    fireEvent.click(screen.getByRole('button', { name: /Push back/ }));
    await screen.findByText('Cut it.');
    const second = mock(api.outreachDraft).mock.calls[1];
    expect(second[0]).toBe('p1');
    expect(second[1].map((t: { role: string }) => t.role)).toEqual(['assistant', 'user']);
    expect(second[1][1].content).toBe('shorter');
    // Both sides of the exchange stay on screen.
    expect(screen.getByText(/you: shorter/)).toBeInTheDocument();
    expect(screen.getByText('Led with the number.')).toBeInTheDocument();
  });

  test('what came back is recorded in their words, with the status', async () => {
    mock(api.outreachProspects).mockResolvedValue(
      list([{ ...rob, status: 'sent', sentText: rob.message, sentAt: '2026-09-08T10:00:00Z' }]),
    );
    render(<OutreachWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Rob Hallam/ }));
    fireEvent.change(screen.getByLabelText(/What came back/), { target: { value: 'said maybe next month' } });
    fireEvent.change(screen.getByLabelText(/Status/), { target: { value: 'replied' } });
    fireEvent.click(screen.getByRole('button', { name: /Record outcome/ }));
    await waitFor(() =>
      expect(api.outreachUpdate).toHaveBeenCalledWith('p1', { status: 'replied', outcome: 'said maybe next month' }),
    );
  });

  test('a new prospect is added through the form and the list refreshes', async () => {
    mock(api.outreachCreate).mockResolvedValue({ prospect: { ...rob, id: 'p2', name: 'Jack Friks' } });
    render(<OutreachWorkbench />);
    await screen.findByRole('button', { name: /Rob Hallam/ });
    fireEvent.click(screen.getByRole('button', { name: /Add a prospect/ }));
    fireEvent.change(screen.getByPlaceholderText(/^Name$/), { target: { value: 'Jack Friks' } });
    fireEvent.change(screen.getByPlaceholderText(/handle, address or URL/), { target: { value: '@jackfriks' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await waitFor(() => expect(api.outreachCreate).toHaveBeenCalled());
    expect(mock(api.outreachCreate).mock.calls[0][0]).toMatchObject({
      name: 'Jack Friks',
      handle: '@jackfriks',
      channel: 'x',
    });
    await waitFor(() => expect(api.outreachProspects).toHaveBeenCalledTimes(2));
  });

  test('the summary refuses a pattern below ten sent, in words', async () => {
    render(<OutreachWorkbench />);
    expect(await screen.findByText(/0 sent, 0 answered/)).toBeInTheDocument();
  });

  test('the log line for the contract is one click away', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OutreachWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Rob Hallam/ }));
    fireEvent.click(screen.getByRole('button', { name: /Copy log line/ }));
    expect(writeText).toHaveBeenCalledWith('1. Rob Hallam (B), not sent yet via x. Answer: none yet. Floor: none.');
  });
});
