import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Otto on the operator door (the operator-door design note).
 *
 * The behaviour worth pinning is what the page believes about the world. Otto
 * is a model: he can say "your floor is live" when nothing was created. The
 * door to a floor may therefore only come from `opened`, which the server
 * reads back from the database, never from his prose.
 */

type Reply = {
  answer: string;
  opened: Array<{ name: string; slug: string | null }>;
  handoff: string;
  settled?: string[];
  open?: string[];
  checklist?: {
    blocking: string[];
    items: Array<{ id: string; label: string; status: 'done' | 'open'; note: string }>;
  } | null;
};
const askSetup = vi.fn(async (): Promise<Reply> => ({ answer: 'Opened it.', opened: [], handoff: '' }));
/** The component streams. The mock plays a reply back through onDelta the way
 *  the server does, so the tests exercise the path that actually runs; a test
 *  can hold `streamPause` to freeze the stream mid-answer and look at it. */
let streamPause: Promise<void> | null = null;
const askHandoff = vi.fn(async () => ({ handoff: '', settled: [] as string[], open: [] as string[], written: true }));
vi.mock('../../lib/api', () => ({
  api: {
    askSetupHandoff: (m: unknown, s: unknown) => askHandoff(m as never, s as never),
    askSetupStream: async (m: unknown, s: unknown, onDelta: (t: string) => void) => {
      const reply = await askSetup(m as never, s as never);
      const words = (reply.answer ?? '').split(' ');
      for (let i = 0; i < words.length; i++) {
        onDelta(words[i] + (i === words.length - 1 ? '' : ' '));
        if (streamPause) await streamPause;
      }
      return reply;
    },
  },
}));

import { SetupChat } from '../SetupChat';

const renderChat = (signedIn = true) =>
  render(
    <MemoryRouter>
      <SetupChat signedIn={signedIn} />
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  askHandoff.mockClear();
  askHandoff.mockResolvedValue({ handoff: '', settled: [], open: [], written: true });
  // jsdom has no scrollIntoView; the log scrolls itself on every turn.
  Element.prototype.scrollIntoView = vi.fn();
  askSetup.mockClear();
  askSetup.mockResolvedValue({ answer: 'Opened it.', opened: [] });
  askHandoff.mockResolvedValue({ handoff: '', settled: [], open: [], written: true });
});

describe('the setup conversation', () => {
  test('sends the whole conversation, so a follow-up means something', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'I run an arbitration protocol');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(askSetup).toHaveBeenCalled());

    askSetup.mockResolvedValue({ answer: 'Then disputes it is.', opened: [] });
    askHandoff.mockResolvedValue({ handoff: '', settled: [], open: [], written: true });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'monthly disputes then');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(askSetup).toHaveBeenCalledTimes(2));
    const second = askSetup.mock.calls[1][0] as Array<{ role: string; content: string }>;
    expect(second).toHaveLength(3);
    expect(second[0].content).toBe('I run an arbitration protocol');
    expect(second[1].role).toBe('assistant');
  });

  test('the door to a floor appears only when the server says one exists', async () => {
    const user = userEvent.setup();
    renderChat();

    // He CLAIMS to have opened it and the server reports nothing opened.
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'set me up');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText('Opened it.')).toBeTruthy());
    expect(screen.queryByRole('link', { name: /kleros/i })).toBeNull();

    askSetup.mockResolvedValue({ answer: 'Done.', opened: [{ name: 'Kleros', slug: 'kleros' }] });
    askHandoff.mockResolvedValue({ handoff: '', settled: [], open: [], written: true });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'go on then');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // The receipt names the floor and its address, and the link goes there.
    expect(await screen.findByText('Kleros')).toBeTruthy();
    expect(screen.getByText('telarchy.com/kleros')).toBeTruthy();
    expect(screen.getByRole('link', { name: /kleros/i }).getAttribute('href')).toBe('/kleros');
  });

  test('a failure is shown rather than swallowed', async () => {
    askSetup.mockRejectedValueOnce(new Error('That is a lot of questions.'));
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/a lot of questions/i)).toBeTruthy();
  });

  test('signed out, he says he cannot open anything and offers the door', () => {
    renderChat(false);
    expect(screen.getByText(/he creates nothing/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /create an account/i })).toBeTruthy();
  });
});

describe('the handoff to your own agent', () => {
  test('appears once the server sends one, and carries what it said', async () => {
    askSetup.mockResolvedValue({ answer: 'Which number?', opened: [] });
    askHandoff.mockResolvedValue({
      handoff: 'You are picking up a Telarchy setup.\nworkspace id ws-42',
      settled: [],
      open: [],
      written: true,
    });
    const user = userEvent.setup();
    renderChat();

    // Nothing to hand off before the conversation starts. Asserted on the
    // rail's own control rather than its heading text, because the hero's
    // copy now also mentions your own agent.
    expect(screen.queryByRole('button', { name: /copy prompt/i })).toBeNull();

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'arbitration protocol');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('button', { name: /copy prompt/i })).toBeTruthy();
    expect(screen.getByText(/workspace id ws-42/)).toBeTruthy();
  });

  test('is replaced by the newest one, never appended to', async () => {
    const user = userEvent.setup();
    renderChat();

    askSetup.mockResolvedValue({ answer: 'One.', opened: [] });
    askHandoff.mockResolvedValue({ handoff: 'FIRST HANDOFF', settled: [], open: [], written: true });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'a');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('FIRST HANDOFF');

    askSetup.mockResolvedValue({ answer: 'Two.', opened: [] });
    askHandoff.mockResolvedValue({ handoff: 'SECOND HANDOFF', settled: [], open: [], written: true });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'b');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('SECOND HANDOFF')).toBeTruthy();
    // A stale prompt is worse than none: an agent would act on the old ids.
    expect(screen.queryByText('FIRST HANDOFF')).toBeNull();
  });

  test('copying puts the prompt on the clipboard', async () => {
    askSetup.mockResolvedValue({ answer: 'ok', opened: [] });
    askHandoff.mockResolvedValue({ handoff: 'PASTE ME', settled: [], open: [], written: true });
    const user = userEvent.setup();
    // AFTER setup(): userEvent installs its own clipboard stub, so a stub
    // defined before this line is the one that gets replaced.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderChat();

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'a');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('PASTE ME');
    await user.click(screen.getByRole('button', { name: /copy prompt/i }));

    expect(writeText).toHaveBeenCalledWith('PASTE ME');
    expect(await screen.findByRole('button', { name: /copied/i })).toBeTruthy();
  });
});

describe('what the conversation carries forward', () => {
  test('settled decisions go back with the next turn, so Otto stops re-asking', async () => {
    const user = userEvent.setup();
    renderChat();

    askSetup.mockResolvedValue({ answer: 'Good.', opened: [] });
    askHandoff.mockResolvedValue({ handoff: 'X'.repeat(220), settled: ['subject', 'number'], open: [], written: true });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'kleros');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(askSetup).toHaveBeenCalledTimes(1));
    // Nothing was settled before the first turn.
    expect(askSetup.mock.calls[0][1]).toEqual([]);

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'disputes');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(askSetup).toHaveBeenCalledTimes(2));
    expect(askSetup.mock.calls[1][1]).toEqual(['subject', 'number']);
  });

  test('the floor state shows what is blocking, not just what is done', async () => {
    askSetup.mockResolvedValue({
      answer: 'Opened.',
      opened: [],
      checklist: {
        blocking: ['Every market holds zero liquidity, so every trade against them is refused.'],
        items: [
          { id: 'number', label: 'The number', status: 'done', note: 'Monthly disputes, 1 open market.' },
          { id: 'liquidity', label: 'Liquidity', status: 'open', note: 'Every market holds zero.' },
        ],
      },
    });
    const user = userEvent.setup();
    renderChat();
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'go');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/every trade against them is refused/i)).toBeTruthy();
    expect(screen.getByText('The number')).toBeTruthy();
    expect(screen.getByText('Liquidity')).toBeTruthy();
  });
});

describe('the vocabulary a visitor reads', () => {
  test('never says "floor"', async () => {
    // Owner, 2026-08-14: "what the hell is floor, no one will understand
    // that". docs/ui-conventions.md makes it a rule: the word is internal
    // vocabulary, component and class names may keep it, and no string a
    // visitor can read may. When copy needs a word for one public workspace
    // it is "market". Everything this door says was written after that rule
    // and broke it, which is why the test is here rather than in review.
    askSetup.mockResolvedValue({
      answer: 'Which number?',
      opened: [{ name: 'Kleros', slug: 'kleros' }],
      handoff: 'X'.repeat(220),
    });
    const user = userEvent.setup();
    const { container } = renderChat(false);
    expect(container.textContent).not.toMatch(/floor/i);

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'a protocol');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('Which number?');
    // Includes the receipt, which names what was opened.
    expect(container.textContent).not.toMatch(/floor/i);
  });
});

describe('leaving to make an account', () => {
  test('the conversation is there when they come back', async () => {
    const user = userEvent.setup();
    askSetup.mockResolvedValue({ answer: 'Then the number is monthly disputes.', opened: [] });
    askHandoff.mockResolvedValue({ handoff: 'X'.repeat(220), settled: ['subject'], open: [], written: true });
    const first = renderChat(false);
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'I run an arbitration protocol');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('Then the number is monthly disputes.');
    first.unmount();

    // Signing up leaves the page entirely and comes back to it.
    renderChat(true);
    expect(await screen.findByText('Then the number is monthly disputes.')).toBeTruthy();
    expect(screen.getByText('I run an arbitration protocol')).toBeTruthy();
    // And what was settled goes back with the next turn, so Otto does not
    // re-ask what they answered before they had an account.
    askSetup.mockClear();
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'disputes, then');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(askSetup).toHaveBeenCalled());
    expect(askSetup.mock.calls[0][1]).toEqual(['subject']);
  });

  test('a finished setup is not offered back as unfinished', async () => {
    const user = userEvent.setup();
    askSetup.mockResolvedValue({ answer: 'Opened.', opened: [{ name: 'Kleros', slug: 'kleros' }] });
    const first = renderChat(true);
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'go');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('link', { name: /kleros/i });
    first.unmount();

    renderChat(true);
    expect(screen.queryByText('Opened.')).toBeNull();
  });
});

describe('before the session check comes back', () => {
  test('the door claims nothing about whether they have an account', () => {
    // The page renders while the check is still out, and reading "not yet
    // known" as "signed out" is what told a signed-in visitor to create an
    // account they already had (owner, 2026-08-24).
    render(
      <MemoryRouter>
        <SetupChat signedIn={null} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /create an account/i })).toBeNull();
    expect(screen.queryByText(/opening it takes an account/i)).toBeNull();
    expect(screen.queryByText(/Otto acts with your account/i)).toBeNull();
    // The composer is there either way: nothing about it needs an account.
    expect(screen.getByLabelText(/tell otto what you run/i)).toBeTruthy();
  });
});

describe('watching the answer arrive', () => {
  test('the words appear as they come, not all at the end', async () => {
    // Owner direction 2026-08-24: "so i dont have to wait". Otto reasons and
    // sometimes calls the API before he speaks, so a whole answer can be half
    // a minute of nothing on screen.
    let release!: () => void;
    streamPause = new Promise<void>(r => {
      release = r;
    });
    askSetup.mockResolvedValue({ answer: 'Monthly disputes, then.', opened: [] });
    askHandoff.mockResolvedValue({ handoff: '', settled: [], open: [], written: true });

    const user = userEvent.setup();
    renderChat();
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'kleros');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // First word on screen while the rest is still coming.
    // Testing Library normalises whitespace, so the trailing space is gone:
    // this matches a turn whose whole text is the first word.
    expect(await screen.findByText('Monthly')).toBeTruthy();
    expect(screen.queryByText('Monthly disputes, then.')).toBeNull();

    streamPause = null;
    release();
    expect(await screen.findByText('Monthly disputes, then.')).toBeTruthy();
  });

  test('a stream that dies takes its half-written sentence with it', async () => {
    askSetup.mockRejectedValueOnce(new Error('Otto stopped mid-answer. Ask again.'));
    const user = userEvent.setup();
    renderChat();
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'kleros');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/stopped mid-answer/i)).toBeTruthy();
    // A sentence that stops mid-word, left under an error, reads as something
    // Otto said.
    expect(screen.queryByText('', { selector: '.setup-otto' })).toBeNull();
  });
});

describe('the two halves of the rail arrive separately', () => {
  test('the floor state does not wait for the prompt to be written', async () => {
    // The state is a database read that lands with the answer; the prompt is
    // a second model call. Gating the surer half behind the slower one is
    // what made a turn take longer than the beta proxy would wait.
    let release!: (v: { handoff: string; settled: string[]; open: string[]; written: boolean }) => void;
    askHandoff.mockImplementation(
      (() =>
        new Promise(r => {
          release = r;
        })) as never,
    );
    askSetup.mockResolvedValue({
      answer: 'Opened.',
      opened: [],
      checklist: {
        blocking: ['Every market is thin enough that 5 credits moves it.'],
        items: [{ id: 'liquidity', label: 'Liquidity', status: 'open', note: '0.5 credits.' }],
      },
    });

    const user = userEvent.setup();
    renderChat();
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'go');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // State is up while the prompt is still being written.
    expect(await screen.findByText(/5 credits moves it/i)).toBeTruthy();
    expect(screen.getByText(/writing the prompt/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /rewriting/i })).toBeDisabled();

    release({ handoff: 'PASTE ME NOW'.padEnd(220, '.'), settled: [], open: [], written: true });
    expect(await screen.findByText(/PASTE ME NOW/)).toBeTruthy();
  });

  test('a prompt that fails to arrive does not take the answer with it', async () => {
    askHandoff.mockRejectedValueOnce(new Error('gateway down'));
    askSetup.mockResolvedValue({ answer: 'Monthly disputes, then.', opened: [] });
    const user = userEvent.setup();
    renderChat();
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'go');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Monthly disputes, then.')).toBeTruthy();
    expect(screen.queryByText(/not answering/i)).toBeNull();
  });
});

describe('the receipt says what the rows say', () => {
  const market = {
    metricName: 'Monthly disputes',
    rangeMin: 0,
    rangeMax: 5000,
    targetDate: '2026-09',
    consensus: 2500,
    pool: 240,
  };

  const openWith = async (checklist: unknown) => {
    askSetup.mockResolvedValue({
      answer: 'Opened.',
      opened: [{ name: 'Kleros', slug: 'kleros' }],
      checklist,
    } as never);
    const user = userEvent.setup();
    renderChat();
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'go');
    await user.click(screen.getByRole('button', { name: /send/i }));
    return screen.findByRole('link', { name: /kleros/i });
  };

  test('a market with no number on it does not say Live', async () => {
    // What the owner saw: a receipt reading LIVE over an address that
    // answered "there is no market at this address".
    await openWith({ blocking: [], market: null, items: [] });
    expect(screen.getByText(/opened, no number yet/i)).toBeTruthy();
    expect(screen.queryByText(/^Live$/)).toBeNull();
  });

  test('a market nobody can trade says that instead', async () => {
    await openWith({ blocking: [], market: { ...market, consensus: null, pool: 0 }, items: [] });
    expect(screen.getByText(/nothing behind it/i)).toBeTruthy();
  });

  test('and a real one says Live', async () => {
    await openWith({ blocking: [], market, items: [] });
    expect(screen.getByText('Live')).toBeTruthy();
  });
});
