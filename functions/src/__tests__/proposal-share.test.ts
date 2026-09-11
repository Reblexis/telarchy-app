import { describe, expect, test } from '@jest/globals';
import { injectProposalMeta, proposalMetaText, type ShareMetaProposal } from '../lib/share-meta';

/**
 * A proposal has an address and a card (docs/ui-conventions.md, "A proposal
 * has an address and a card", 2026-09-09).
 *
 * A decision is the one thing on this site worth sending to one person, and
 * until now every page unfurled with the same generic site card, so it could
 * not be sent to the person who knows how to price it.
 */
const base: ShareMetaProposal = {
  floorName: 'Telarchy',
  number: 28,
  title: 'A 500 dollar prize for the best open-source trading agent',
  askUsd: null,
  impact: 1.36,
  metricLabel: 'active traders',
  unit: '',
  decideBy: '15 September 2026',
  decided: null,
};

describe('what a proposal link says', () => {
  test('the title asks the decision and answers with the market', () => {
    const { title } = proposalMetaText(base);
    expect(title).toBe(
      'Should Telarchy do: A 500 dollar prize for the best open-source trading agent? ' +
        'The market says +1.4 active traders if approved.',
    );
  });

  test('a paid proposal names the money in the question', () => {
    const { title, description } = proposalMetaText({ ...base, askUsd: 250 });
    expect(title).toContain('Should Telarchy pay $250 for:');
    expect(description).toContain('$250 to the proposer if approved.');
  });

  test('a metric with a currency keeps its unit on the impact', () => {
    const { title } = proposalMetaText({ ...base, impact: 1838.97, unit: '$', metricLabel: 'net revenue' });
    expect(title).toContain('+$1,839 net revenue');
  });

  test('an unpriced proposal says so rather than inventing a number', () => {
    expect(proposalMetaText({ ...base, impact: null }).title).toContain('Nobody has priced it yet.');
  });

  test('a decided proposal states the ruling instead of asking', () => {
    const { title, description } = proposalMetaText({ ...base, decided: 'approved' });
    expect(title).toMatch(/^Telarchy approved #28:/);
    expect(description).not.toContain('Decided by');
  });

  test('the description says what it costs and by when', () => {
    const { description } = proposalMetaText(base);
    expect(description).toBe(
      'No payment asked. Decided by 15 September 2026. ' +
        'Anyone can price it: bet on which world lands higher, or post a proposal of your own.',
    );
  });
});

describe('what the head carries', () => {
  const html =
    '<html><head><title>Telarchy</title><meta name="description" content="old">' +
    '<meta property="og:title" content="old"></head><body></body></html>';

  test('the static tags are replaced, never doubled', () => {
    const out = injectProposalMeta(html, base, 'https://telarchy.com/telarchy/p/28');
    expect(out.match(/og:title/g)).toHaveLength(1);
    expect(out).not.toContain('content="old"');
    expect(out).toContain('<title>Should Telarchy do:');
    expect(out).toContain('<meta property="og:url" content="https://telarchy.com/telarchy/p/28">');
    // No card given: the small card, not a large one promising a picture.
    expect(out).toContain('<meta name="twitter:card" content="summary">');
  });

  test('a card makes it a large-image unfurl', () => {
    const out = injectProposalMeta(
      html,
      base,
      'https://telarchy.com/telarchy/p/28',
      'https://telarchy.com/api/marketplace/telarchy/p/28/card.png',
    );
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(out).toContain('og:image" content="https://telarchy.com/api/marketplace/telarchy/p/28/card.png"');
  });

  test('a title with a quote in it cannot break out of the tag', () => {
    const out = injectProposalMeta(html, { ...base, title: 'Ship "it" & <b>more</b>' }, 'https://x/y');
    expect(out).toContain('&quot;it&quot; &amp; &lt;b&gt;');
    expect(out).not.toContain('<b>more</b>');
  });
});

describe('what a link to a proposal with options says (docs/ui-conventions.md, "A proposal has an address and a card")', () => {
  const opts: ShareMetaProposal = {
    ...base,
    number: 3437,
    title: 'Game 1, attempt 57, move 3',
    metricLabel: 'reached length',
    impact: 0.4,
    options: true,
    leaderLabel: 'Turn left',
    chosenLabel: null,
  };

  test('a proposal with options names the leader and its lead, never "if approved"', () => {
    const { title } = proposalMetaText(opts);
    expect(title).toBe(
      'Should Telarchy do: Game 1, attempt 57, move 3? The market says Turn left leads by +0.40 reached length.',
    );
    expect(title).not.toContain('if approved');
  });

  test('a tie at the top has no leader: the link says the market has the options tied', () => {
    const { title } = proposalMetaText({ ...opts, impact: 0, leaderLabel: null, tied: true });
    expect(title).toBe('Should Telarchy do: Game 1, attempt 57, move 3? The market has the options tied.');
    expect(title).not.toMatch(/leads|Nobody/);
  });

  test('a proposal with options and no leader says nobody has priced it', () => {
    expect(proposalMetaText({ ...opts, impact: null, leaderLabel: null }).title).toContain('Nobody has priced it yet.');
  });

  test('a decided proposal with options says which option was chosen', () => {
    const { title } = proposalMetaText({ ...opts, decided: 'approved', chosenLabel: 'Turn left' });
    expect(title).toMatch(/^Telarchy chose Turn left on #3437: Game 1, attempt 57, move 3/);
  });

  test('the description of a paid proposal with options says "if chosen" and "which option"', () => {
    const { description } = proposalMetaText({ ...opts, askUsd: 250 });
    expect(description).toContain('$250 to the proposer if chosen.');
    expect(description).toContain('bet on which option lands higher');
    expect(description).not.toContain('if approved');
  });
});
