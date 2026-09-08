/**
 * The outreach workbench's pure parts (docs/outreach-workbench.md): where a
 * message is sent, the log line for the contract, the features a message is
 * scored on, and the summary that refuses to claim a pattern from too little.
 */

import {
  channelLink,
  logLine,
  messageFeatures,
  normaliseProspect,
  summariseOutreach,
  wordCount,
} from '../services/outreach';

describe('channelLink: "how to send it" is a link to where the person reads', () => {
  test('an X handle opens the profile, with or without the @', () => {
    expect(channelLink({ channel: 'x', handle: '@ryancarson' })).toBe('https://x.com/ryancarson');
    expect(channelLink({ channel: 'x', handle: 'ryancarson' })).toBe('https://x.com/ryancarson');
  });

  test('an X URL is kept as given', () => {
    expect(channelLink({ channel: 'x', handle: 'https://x.com/shl' })).toBe('https://x.com/shl');
  });

  test('an email becomes a mailto with the message prefilled', () => {
    const link = channelLink({ channel: 'email', handle: 'a@b.c' }, 'Hey, Viktor here. Want it?');
    expect(link.startsWith('mailto:a@b.c?')).toBe(true);
    expect(decodeURIComponent(link)).toContain('body=Hey, Viktor here. Want it?');
  });

  test('bluesky, linkedin and hn open the profile', () => {
    expect(channelLink({ channel: 'bluesky', handle: 'cliffharris.bsky.social' })).toBe(
      'https://bsky.app/profile/cliffharris.bsky.social',
    );
    expect(channelLink({ channel: 'hn', handle: 'dylanratcliffe' })).toBe(
      'https://news.ycombinator.com/user?id=dylanratcliffe',
    );
    expect(channelLink({ channel: 'linkedin', handle: 'https://linkedin.com/in/x' })).toBe('https://linkedin.com/in/x');
    expect(channelLink({ channel: 'linkedin', handle: 'in/johnwang' })).toBe('https://www.linkedin.com/in/johnwang');
  });

  test('other with a URL is that URL; nothing usable is empty, never a broken link', () => {
    expect(channelLink({ channel: 'other', handle: 'https://oandcogames.com/' })).toBe('https://oandcogames.com/');
    expect(channelLink({ channel: 'other', handle: 'ask around' })).toBe('');
    expect(channelLink({ channel: 'x', handle: null })).toBe('');
  });
});

describe('messageFeatures: the three things a message is scored on', () => {
  test('under 75 words, names a number, names their decision', () => {
    const f = messageFeatures(
      'Hey Rob, SuperX went $23k to $19k MRR. Have you decided on the price yet? Want a floor?',
    );
    expect(f).toEqual({ short: true, hasNumber: true, namesDecision: true, words: 18 });
  });

  test('a long message without a number or a decision scores nothing', () => {
    const long = Array(80).fill('word').join(' ');
    expect(messageFeatures(long)).toEqual({ short: false, hasNumber: false, namesDecision: false, words: 80 });
  });

  test('wordCount counts words, not characters', () => {
    expect(wordCount('one two  three\nfour')).toBe(4);
    expect(wordCount('')).toBe(0);
  });
});

describe('logLine: one line per person for the contract', () => {
  test('a sent prospect with an answer', () => {
    expect(
      logLine(
        {
          name: 'Rob Hallam',
          segment: 'B',
          channel: 'x',
          status: 'replied',
          sentAt: new Date('2026-09-08T10:00:00Z'),
          outcome: 'said maybe next month',
        },
        5,
      ),
    ).toBe('5. Rob Hallam (B), sent 2026-09-08 via x. Answer: replied. Floor: none.');
  });

  test('a floor state is read from the status', () => {
    expect(
      logLine({ name: 'A', segment: 'A', channel: 'email', status: 'activated', sentAt: new Date('2026-09-09') }, 1),
    ).toBe('1. A (A), sent 2026-09-09 via email. Answer: yes. Floor: decided and 2nd value posted.');
    expect(logLine({ name: 'B', segment: null, channel: 'x', status: 'workspace', sentAt: null }, 2)).toBe(
      '2. B, not sent yet via x. Answer: yes. Floor: created.',
    );
    expect(logLine({ name: 'C', segment: 'C', channel: 'x', status: 'no', sentAt: new Date('2026-09-09') }, 3)).toBe(
      '3. C (C), sent 2026-09-09 via x. Answer: no. Floor: none.',
    );
    expect(logLine({ name: 'D', segment: 'A', channel: 'x', status: 'sent', sentAt: new Date('2026-09-09') }, 4)).toBe(
      '4. D (A), sent 2026-09-09 via x. Answer: none yet. Floor: none.',
    );
  });
});

describe('summariseOutreach: what the record says, or an honest refusal', () => {
  const row = (
    over: Partial<{
      segment: string | null;
      channel: string;
      status: string;
      sentText: string | null;
    }> = {},
  ) => ({
    segment: 'A',
    channel: 'x',
    status: 'sent',
    sentText: 'Hey, Viktor here. Have you decided on the price? Want a floor on the $19k?',
    ...over,
  });

  test('below ten sent it says so instead of pretending to a pattern', () => {
    const rows = [row(), row({ status: 'replied' }), row({ status: 'draft', sentText: null })];
    const s = summariseOutreach(rows);
    expect(s.enough).toBe(false);
    expect(s.sent).toBe(2);
    expect(s.replied).toBe(1);
    expect(s.enough ? '' : s.note).toMatch(/2 sent/);
  });

  test('a draft is not sent; only rows that went out count', () => {
    const s = summariseOutreach([row({ status: 'draft', sentText: null }), row({ status: 'ready', sentText: null })]);
    expect(s.sent).toBe(0);
    expect(s.replied).toBe(0);
  });

  test('with ten sent it reports reply rates by segment and channel and the features', () => {
    const rows = [
      ...Array(5)
        .fill(0)
        .map(() => row({ segment: 'A', channel: 'x', status: 'replied' })),
      ...Array(5)
        .fill(0)
        .map(() => row({ segment: 'B', channel: 'email', status: 'sent', sentText: 'Hi. Want it?' })),
    ];
    const s = summariseOutreach(rows);
    expect(s.enough).toBe(true);
    if (!s.enough) return;
    expect(s.sent).toBe(10);
    expect(s.replied).toBe(5);
    expect(s.bySegment).toEqual([
      { key: 'A', sent: 5, replied: 5 },
      { key: 'B', sent: 5, replied: 0 },
    ]);
    expect(s.byChannel).toEqual([
      { key: 'email', sent: 5, replied: 0 },
      { key: 'x', sent: 5, replied: 5 },
    ]);
    const decision = s.features.find(f => f.label === 'names their decision');
    expect(decision).toEqual({ label: 'names their decision', on: 1, off: 0 });
  });

  test('every status after sent counts as a reply; "no" is a reply too', () => {
    const rows = ['sent', 'replied', 'call', 'workspace', 'activated', 'no'].map(status => row({ status }));
    const s = summariseOutreach(rows);
    expect(s.sent).toBe(6);
    expect(s.replied).toBe(5);
  });
});

describe('normaliseProspect: what the import and the form accept', () => {
  test('a name is required; the channel defaults to other; unknown channels are refused', () => {
    expect(() => normaliseProspect({})).toThrow(/name/);
    expect(normaliseProspect({ name: 'A' }).channel).toBe('other');
    expect(() => normaliseProspect({ name: 'A', channel: 'carrier pigeon' })).toThrow(/channel/);
  });

  test('a status outside the list is refused', () => {
    expect(() => normaliseProspect({ name: 'A', status: 'maybe' })).toThrow(/status/);
    expect(normaliseProspect({ name: 'A', status: 'ready' }).status).toBe('ready');
  });

  test('strings are trimmed and empty ones become null', () => {
    const p = normaliseProspect({ name: ' A ', company: '  ', evidence: ' x ', handle: '' });
    expect(p.name).toBe('A');
    expect(p.company).toBeNull();
    expect(p.evidence).toBe('x');
    expect(p.handle).toBeNull();
  });
});
