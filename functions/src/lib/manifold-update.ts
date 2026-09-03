/**
 * The Manifold update: the standings comment the owner posts on the
 * recruiting market, rendered from the season standings and the linked
 * count. Governing doc: docs/manifold-update.md, "What the text says".
 *
 * Pure. Every number arrives already computed by the standings, so this
 * file can only ever change the wording, which is the doc's to change first.
 */

export interface UpdateEntrant {
  nickname: string | null;
  manifoldUsername: string | null;
  /** Settled season score, the ranking key. */
  score: number;
  /** The mark: open positions at the current call. Null before settled scoring. */
  markedScore: number | null;
  projectedPrizeUsd: number;
  markedProjectedPrizeUsd: number | null;
}

export interface UpdateInput {
  linked: number;
  season: { id: string; name: string; status: string } | null;
  /** In standings order (rank ascending). */
  participants: UpdateEntrant[];
}

/** Manifold renders `@handle` as a mention; a Telarchy nickname stays plain. */
function name(e: UpdateEntrant): string {
  if (e.manifoldUsername) return `@${e.manifoldUsername}`;
  return e.nickname ?? 'anonymous';
}

const cents = (n: number) => n.toFixed(2);
const signed = (n: number) => (n < 0 ? cents(n) : `+${cents(n)}`);

export function renderManifoldUpdate(input: UpdateInput): string {
  const lines: string[] = ['UPDATE:', `Status: ${input.linked} linked Manifolders.`];

  if (!input.season) {
    lines.push('No season is running.');
    return `${lines.join('\n\n')}\n`;
  }

  lines.push(
    'Current season leaderboard standings and prizes',
    '===================================',
    'By settled profit:',
  );

  const rows = input.participants;
  if (rows.length === 0) {
    lines.push('Nobody has entered yet.');
    return `${lines.join('\n\n')}\n`;
  }

  // Standings order is the season's own ranking; a zero settles at the end
  // of it, so the group of zeros is always a suffix. A negative score is not
  // zero and keeps its own line: hiding a loss in "so far" would misreport.
  const zeroStart = (() => {
    let i = rows.length;
    while (i > 0 && rows[i - 1].score === 0) i--;
    return i;
  })();
  rows.slice(0, zeroStart).forEach((e, i) => {
    lines.push(`${i + 1}. ${name(e)} ($${cents(e.projectedPrizeUsd)} | ${signed(e.score)}cr settled)`);
  });
  const zeros = rows.slice(zeroStart);
  if (zeros.length > 0) {
    const first = zeroStart + 1;
    const last = rows.length;
    const rank = zeros.length === 1 ? `${first}.` : `${first}.-${last}.`;
    lines.push(`${rank} ${zeros.map(name).join(', ')} ($0 | +0cr settled so far)`);
  }

  const marked = rows
    .filter(e => (e.markedScore ?? 0) > 0)
    .sort((a, b) => (b.markedScore ?? 0) - (a.markedScore ?? 0))
    .slice(0, 5);
  if (marked.length > 0) {
    lines.push('Total if prices hold:');
    marked.forEach((e, i) => {
      lines.push(
        `${i + 1}. ${name(e)} ($${Math.round(e.markedProjectedPrizeUsd ?? 0)} | ${signed(e.markedScore ?? 0)}cr total)`,
      );
    });
  }

  return `${lines.join('\n\n')}\n`;
}
