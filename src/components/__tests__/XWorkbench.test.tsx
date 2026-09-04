import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The workbench's two load-bearing behaviours (docs/x-workbench.md):
 * a failed X read must not block drafting (he can paste the text), and the
 * argument must accumulate, so "shorter" means shorter than the last draft.
 */
vi.mock('../../lib/api', () => ({
  api: {
    xLog: vi.fn(),
    xLookupPost: vi.fn(),
    xDraftReply: vi.fn(),
    xDraftPost: vi.fn(),
    xAsk: vi.fn(),
    xRecordReply: vi.fn(),
    xAttachReplyId: vi.fn(),
    xSuggestSearch: vi.fn(),
    xSaveSearch: vi.fn(),
    xSearches: vi.fn(),
    xHarvestSearch: vi.fn(),
    xGetVoiceProfile: vi.fn(),
    xSetVoiceProfile: vi.fn(),
  },
}));

import { api } from '../../lib/api';
import { XWorkbench } from '../XWorkbench';

const emptyLog = {
  replies: [],
  summary: { enough: false as const, note: '0 replies' },
  draftingConfigured: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.xLog as ReturnType<typeof vi.fn>).mockResolvedValue(emptyLog);
  (api.xSearches as ReturnType<typeof vi.fn>).mockResolvedValue({
    searches: [],
  });
});

describe('the X workbench', () => {
  test('a broken X read still lets him draft from pasted text', async () => {
    (api.xLookupPost as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('X returned 404 for that post.'));
    (api.xDraftReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: {
        reply: 'HP beat its own forecasts in 6 of 8 cases.',
        reason: 'counterexample',
      },
    });
    render(<XWorkbench />);

    fireEvent.change(screen.getByPlaceholderText(/status\/123/), {
      target: { value: '999' },
    });
    fireEvent.click(screen.getByRole('button', { name: /read post/i }));
    await screen.findByText(/X returned 404/);

    // The endpoint is undocumented and will break; the paste box is the escape.
    fireEvent.change(screen.getByPlaceholderText(/paste the post text/i), {
      target: { value: 'Forecasting inside companies never works.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /draft a reply/i }));

    await screen.findByDisplayValue(/HP beat its own forecasts/);
    expect((api.xDraftReply as ReturnType<typeof vi.fn>).mock.calls[0][0].postText).toBe(
      'Forecasting inside companies never works.',
    );
  });

  test('pushing back sends the whole argument, not just the last word', async () => {
    (api.xLookupPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      post: {
        id: '42',
        author: 'someone',
        authorName: 'Someone',
        text: 'Markets cannot price internal work.',
        likes: 3,
        replies: 1,
        createdAt: null,
      },
    });
    const draftFn = api.xDraftReply as ReturnType<typeof vi.fn>;
    draftFn.mockResolvedValueOnce({
      draft: { reply: 'A long first attempt at a reply.', reason: 'disagree' },
    });
    draftFn.mockResolvedValueOnce({
      draft: { reply: 'Short one.', reason: 'disagree' },
    });

    render(<XWorkbench />);
    fireEvent.change(screen.getByPlaceholderText(/status\/123/), {
      target: { value: '42' },
    });
    fireEvent.click(screen.getByRole('button', { name: /read post/i }));
    await screen.findByText(/Markets cannot price internal work/);

    fireEvent.click(screen.getByRole('button', { name: /draft a reply/i }));
    await screen.findByDisplayValue(/A long first attempt/);

    fireEvent.change(screen.getByPlaceholderText(/what is wrong/i), {
      target: { value: 'shorter' },
    });
    fireEvent.click(screen.getByRole('button', { name: /push back/i }));
    await screen.findByDisplayValue('Short one.');

    // The second call carries the first draft AND the pushback, which is what
    // makes "shorter" mean shorter than that draft.
    const second = draftFn.mock.calls[1][0];
    expect(second.messages).toHaveLength(2);
    expect(second.messages[0].role).toBe('assistant');
    expect(second.messages[1]).toEqual({ role: 'user', content: 'shorter' });
  });

  test('recording what he sent stores the edited text, not the draft', async () => {
    (api.xLookupPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      post: {
        id: '42',
        author: 'someone',
        authorName: 'S',
        text: 'A claim.',
        likes: 0,
        replies: 0,
        createdAt: null,
      },
    });
    (api.xDraftReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { reply: 'The draft.', reason: 'disagree' },
    });
    (api.xRecordReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      recorded: {},
    });

    render(<XWorkbench />);
    fireEvent.change(screen.getByPlaceholderText(/status\/123/), {
      target: { value: '42' },
    });
    fireEvent.click(screen.getByRole('button', { name: /read post/i }));
    await screen.findByText('A claim.');
    fireEvent.click(screen.getByRole('button', { name: /draft a reply/i }));
    const box = await screen.findByDisplayValue('The draft.');

    fireEvent.change(box, { target: { value: 'What I actually said.' } });
    fireEvent.click(screen.getByRole('button', { name: /i sent this/i }));

    await waitFor(() =>
      expect((api.xRecordReply as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        sourcePostId: '42',
        text: 'What I actually said.',
      }),
    );
  });

  test('the search loop: suggest, take it, paste ids, work on one', async () => {
    (api.xSuggestSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
      suggestion: {
        query: 'futarchy -filter:replies min_faves:5',
        rationale: 'Thread starters, not headlines.',
      },
    });
    (api.xSaveSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
      search: {
        id: 's1',
        query: 'futarchy -filter:replies min_faves:5',
        rationale: null,
        harvested: 0,
        lastUsedAt: null,
        createdAt: '2026-09-02',
      },
    });
    (api.xHarvestSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
      posts: [
        {
          id: '7',
          author: 'someone',
          authorName: 'S',
          text: 'Markets cannot price internal work.',
          likes: 4,
          replies: 2,
          createdAt: null,
        },
      ],
      failed: [],
    });

    render(<XWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /get a search prompt/i }));
    await screen.findByText('futarchy -filter:replies min_faves:5');

    // Taking the query is what starts counting its yield, and the link has to
    // actually point at X's Latest tab or he has to build the URL himself.
    const run = screen.getByRole('link', { name: /run it on x/i });
    expect(run).toHaveAttribute('href', 'https://x.com/search?q=futarchy%20-filter%3Areplies%20min_faves%3A5&f=live');
    fireEvent.click(run);
    await waitFor(() => expect(api.xSaveSearch).toHaveBeenCalled());

    fireEvent.change(await screen.findByPlaceholderText(/post links or ids you found/i), {
      target: { value: 'https://x.com/someone/status/7' },
    });
    fireEvent.click(screen.getByRole('button', { name: /read these/i }));
    await screen.findByText('Markets cannot price internal work.');

    fireEvent.click(screen.getByRole('button', { name: /work on this one/i }));
    expect(screen.getByRole('button', { name: /draft a reply/i })).toBeTruthy();
  });

  test('a reply from a search is recorded against that search, so its yield is real', async () => {
    (api.xSuggestSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
      suggestion: { query: 'q', rationale: '' },
    });
    (api.xSaveSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
      search: {
        id: 's9',
        query: 'q',
        rationale: null,
        harvested: 0,
        lastUsedAt: null,
        createdAt: '2026-09-02',
      },
    });
    (api.xHarvestSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
      posts: [
        {
          id: '7',
          author: 'a',
          authorName: 'A',
          text: 'A claim.',
          likes: 0,
          replies: 0,
          createdAt: null,
        },
      ],
      failed: [],
    });
    (api.xDraftReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { reply: 'Mine.', reason: 'disagree' },
    });
    (api.xRecordReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      recorded: {},
    });

    render(<XWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /get a search prompt/i }));
    fireEvent.click(await screen.findByRole('link', { name: /run it on x/i }));
    fireEvent.change(await screen.findByPlaceholderText(/post links or ids you found/i), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /read these/i }));
    fireEvent.click(await screen.findByRole('button', { name: /work on this one/i }));
    fireEvent.click(screen.getByRole('button', { name: /draft a reply/i }));
    await screen.findByDisplayValue('Mine.');
    fireEvent.click(screen.getByRole('button', { name: /i sent this/i }));

    await waitFor(() =>
      expect((api.xRecordReply as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        sourcePostId: '7',
        searchId: 's9',
      }),
    );
  });

  test('the reply draft shows what it says to him, not only the text', async () => {
    (api.xLookupPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      post: {
        id: '42',
        author: 'someone',
        authorName: 'S',
        text: 'A claim.',
        likes: 0,
        replies: 0,
        createdAt: null,
      },
    });
    (api.xDraftReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: {
        reply: 'The draft.',
        reason: 'disagree',
        answer: 'I led with the counterexample because the claim is absolute.',
      },
    });
    render(<XWorkbench />);
    fireEvent.change(screen.getByPlaceholderText(/status\/123/), {
      target: { value: '42' },
    });
    fireEvent.click(screen.getByRole('button', { name: /read post/i }));
    await screen.findByText('A claim.');
    fireEvent.click(screen.getByRole('button', { name: /draft a reply/i }));
    await screen.findByDisplayValue('The draft.');
    expect(screen.getByText(/led with the counterexample/)).toBeTruthy();
  });

  test('write a post: an idea becomes a draft, with its answer, and X opens without a reply target', async () => {
    (api.xDraftPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: {
        post: 'Season 0, week 2: 244 markets, 233 agents, 4 humans.',
        reason: 'milestone',
        answer: 'Numbers first, the humans line is the hook.',
      },
    });
    render(<XWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /write a post/i }));
    fireEvent.change(screen.getByPlaceholderText(/your idea/i), {
      target: { value: '244 markets, 233 agents, only 4 humans' },
    });
    fireEvent.click(screen.getByRole('button', { name: /draft a post/i }));
    await screen.findByDisplayValue(/Season 0, week 2/);
    expect(screen.getByText(/humans line is the hook/)).toBeTruthy();
    expect((api.xDraftPost as ReturnType<typeof vi.fn>).mock.calls[0][0].idea).toBe(
      '244 markets, 233 agents, only 4 humans',
    );
    const open = screen.getByRole('link', { name: /open x with this/i });
    expect(open.getAttribute('href')).not.toContain('in_reply_to');
  });

  test('write a post: each turn shows both sides and sends the whole argument', async () => {
    const draftFn = api.xDraftPost as ReturnType<typeof vi.fn>;
    draftFn.mockResolvedValueOnce({
      draft: {
        post: 'A long first attempt at a post.',
        reason: 'milestone',
        answer: 'First pass.',
      },
    });
    draftFn.mockResolvedValueOnce({
      draft: {
        post: 'Short one.',
        reason: 'milestone',
        answer: 'Cut the second line.',
      },
    });
    render(<XWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /write a post/i }));
    fireEvent.change(screen.getByPlaceholderText(/your idea/i), {
      target: { value: 'an idea' },
    });
    fireEvent.click(screen.getByRole('button', { name: /draft a post/i }));
    await screen.findByDisplayValue(/A long first attempt/);

    fireEvent.change(screen.getByPlaceholderText(/what is wrong/i), {
      target: { value: 'shorter' },
    });
    fireEvent.click(screen.getByRole('button', { name: /push back/i }));
    await screen.findByDisplayValue('Short one.');

    // Both sides of the exchange stay on screen: it is a conversation.
    expect(screen.getByText(/you: shorter/)).toBeTruthy();
    expect(screen.getByText(/First pass\./)).toBeTruthy();
    expect(screen.getByText(/Cut the second line/)).toBeTruthy();
    const second = draftFn.mock.calls[1][0];
    expect(second.idea).toBe('an idea');
    expect(second.messages).toHaveLength(2);
    expect(second.messages[0].role).toBe('assistant');
    expect(second.messages[1]).toEqual({ role: 'user', content: 'shorter' });
  });

  test('recording a post of his own sends kind post and no source', async () => {
    (api.xDraftPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { post: 'The draft.', reason: 'test', answer: '' },
    });
    (api.xRecordReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      recorded: {},
    });
    render(<XWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /write a post/i }));
    fireEvent.change(screen.getByPlaceholderText(/your idea/i), {
      target: { value: 'an idea' },
    });
    fireEvent.click(screen.getByRole('button', { name: /draft a post/i }));
    const box = await screen.findByDisplayValue('The draft.');
    fireEvent.change(box, { target: { value: 'What I actually posted.' } });
    fireEvent.click(screen.getByRole('button', { name: /i posted this/i }));
    await waitFor(() => {
      const sent = (api.xRecordReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sent).toMatchObject({
        kind: 'post',
        text: 'What I actually posted.',
      });
      expect(sent.sourcePostId).toBeUndefined();
    });
  });

  test('a search suggestion can be argued with: its answer shows and the turns are sent', async () => {
    const suggest = api.xSuggestSearch as ReturnType<typeof vi.fn>;
    suggest.mockResolvedValueOnce({
      suggestion: {
        query: 'forecasting',
        rationale: 'Broad.',
        answer: 'A first pass.',
      },
    });
    suggest.mockResolvedValueOnce({
      suggestion: {
        query: 'forecasting min_faves:20',
        rationale: 'Narrower.',
        answer: 'Raised min_faves, as you asked.',
      },
    });
    render(<XWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /get a search prompt/i }));
    await screen.findByText('forecasting');
    expect(screen.getByText(/A first pass/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/narrower/i), {
      target: { value: 'narrower' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^argue$/i }));
    await screen.findByText('forecasting min_faves:20');
    expect(screen.getByText(/Raised min_faves/)).toBeTruthy();
    const second = suggest.mock.calls[1];
    expect(second[1]).toHaveLength(2);
    expect(second[1][0].role).toBe('assistant');
    expect(second[1][1]).toEqual({ role: 'user', content: 'narrower' });
  });

  test('Ask: a question gets an answer on screen, and the follow-up carries the conversation', async () => {
    const ask = api.xAsk as ReturnType<typeof vi.fn>;
    ask.mockResolvedValueOnce({
      answer: 'Phase 1 is replies. Your record has no post yet.',
    });
    ask.mockResolvedValueOnce({
      answer: 'Because a one-follower account is retrieved for nobody.',
    });
    render(<XWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    fireEvent.change(screen.getByPlaceholderText(/what kind of posts/i), {
      target: { value: 'what should i post this week?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await screen.findByText(/Phase 1 is replies/);
    expect(ask.mock.calls[0][0]).toEqual([{ role: 'user', content: 'what should i post this week?' }]);

    fireEvent.change(screen.getByPlaceholderText(/what kind of posts/i), {
      target: { value: 'why replies?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await screen.findByText(/retrieved for nobody/);
    // Both questions and both answers stay on screen, in order.
    expect(screen.getByText(/you: what should i post this week\?/)).toBeTruthy();
    expect(screen.getByText(/you: why replies\?/)).toBeTruthy();
    expect(ask.mock.calls[1][0]).toHaveLength(3);
    expect(ask.mock.calls[1][0][2]).toEqual({
      role: 'user',
      content: 'why replies?',
    });
  });
});
