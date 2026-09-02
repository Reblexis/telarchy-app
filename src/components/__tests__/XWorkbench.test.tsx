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

const emptyLog = { replies: [], summary: { enough: false as const, note: '0 replies' }, draftingConfigured: true };

beforeEach(() => {
  vi.clearAllMocks();
  (api.xLog as ReturnType<typeof vi.fn>).mockResolvedValue(emptyLog);
  (api.xSearches as ReturnType<typeof vi.fn>).mockResolvedValue({ searches: [] });
});

describe('the X workbench', () => {
  test('a broken X read still lets him draft from pasted text', async () => {
    (api.xLookupPost as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('X returned 404 for that post.'));
    (api.xDraftReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { reply: 'HP beat its own forecasts in 6 of 8 cases.', reason: 'counterexample' },
    });
    render(<XWorkbench />);

    fireEvent.change(screen.getByPlaceholderText(/status\/123/), { target: { value: '999' } });
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
    draftFn.mockResolvedValueOnce({ draft: { reply: 'A long first attempt at a reply.', reason: 'disagree' } });
    draftFn.mockResolvedValueOnce({ draft: { reply: 'Short one.', reason: 'disagree' } });

    render(<XWorkbench />);
    fireEvent.change(screen.getByPlaceholderText(/status\/123/), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /read post/i }));
    await screen.findByText(/Markets cannot price internal work/);

    fireEvent.click(screen.getByRole('button', { name: /draft a reply/i }));
    await screen.findByDisplayValue(/A long first attempt/);

    fireEvent.change(screen.getByPlaceholderText(/what is wrong/i), { target: { value: 'shorter' } });
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
      post: { id: '42', author: 'someone', authorName: 'S', text: 'A claim.', likes: 0, replies: 0, createdAt: null },
    });
    (api.xDraftReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { reply: 'The draft.', reason: 'disagree' },
    });
    (api.xRecordReply as ReturnType<typeof vi.fn>).mockResolvedValue({ recorded: {} });

    render(<XWorkbench />);
    fireEvent.change(screen.getByPlaceholderText(/status\/123/), { target: { value: '42' } });
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
      suggestion: { query: 'futarchy -filter:replies min_faves:5', rationale: 'Thread starters, not headlines.' },
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
      search: { id: 's9', query: 'q', rationale: null, harvested: 0, lastUsedAt: null, createdAt: '2026-09-02' },
    });
    (api.xHarvestSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
      posts: [{ id: '7', author: 'a', authorName: 'A', text: 'A claim.', likes: 0, replies: 0, createdAt: null }],
      failed: [],
    });
    (api.xDraftReply as ReturnType<typeof vi.fn>).mockResolvedValue({ draft: { reply: 'Mine.', reason: 'disagree' } });
    (api.xRecordReply as ReturnType<typeof vi.fn>).mockResolvedValue({ recorded: {} });

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
});
