import { useState } from 'react';
import { api } from '../lib/api';

/**
 * "Ask anything about this floor" (owner ask 2026-08-20: reduce friction for
 * traders).
 *
 * The friction it removes is specific. A visitor looking at "the market says
 * 25" has no way to judge whether 25 is right without knowing what the
 * company sells, how the number is measured, and what has already been
 * priced. That knowledge exists, spread across a chart, a definition, a
 * charter, eight contracts and a data room, and reading all of it is more
 * work than the bet is worth. One question is not.
 *
 * So this sits in the decision column, under the conversation rather than in
 * a corner bubble: a corner bubble reads as support ("having trouble?"), and
 * this is research ("before you price it"). It is the LAST thing in the
 * column (owner direction 2026-08-20) because it is what a reader reaches for
 * once the market, the comments and the positions have all failed to answer
 * them, and because the page's job is the market.
 *
 * One question and one answer, nothing else. The prompt for pointing your own
 * AI at the same brief used to hang off the bottom of this component and now
 * lives in account settings (same owner direction: the floor is not the place
 * to keep every door). The facts are the same either way: everything comes
 * from GET /api/marketplace/:id/context.
 */

interface Props {
  idOrSlug: string;
  workspaceName: string;
  /** The number the floor leads with, used for one suggested question. */
  metricLabel: string | null;
}

export function AskFloor({ idOrSlug, workspaceName, metricLabel }: Props) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Suggestions exist because "ask anything" is a blank page, and a blank
  // page is friction of its own. They name this floor's actual subjects.
  const suggestions = [
    `What does ${workspaceName} sell?`,
    metricLabel ? `Why is ${metricLabel.toLowerCase()} where it is?` : 'How is this number measured?',
    'Which contract would move the number most?',
  ];

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      const res = await api.askFloor(idOrSlug, q);
      setAnswer({ q, a: res.answer });
      setQuestion('');
    } catch (e) {
      setError((e as Error).message || 'Could not answer that right now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="askfloor" aria-label={`Ask about ${workspaceName}`}>
      <form
        className="askfloor-bar"
        onSubmit={e => { e.preventDefault(); void ask(question); }}
      >
        <input
          className="askfloor-input"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder={`Ask anything about ${workspaceName}`}
          maxLength={500}
          aria-label={`Ask anything about ${workspaceName}`}
        />
        <button className="askfloor-go" type="submit" disabled={busy || !question.trim()}>
          {busy ? 'Reading…' : 'Ask'}
        </button>
      </form>

      {!answer && !busy && (
        <div className="askfloor-suggest">
          {suggestions.map(s => (
            <button key={s} type="button" className="askfloor-chip" onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {busy && <p className="askfloor-working" role="status">Reading this floor&rsquo;s brief…</p>}

      {answer && (
        <div className="askfloor-answer">
          <p className="askfloor-q">{answer.q}</p>
          <p className="askfloor-a">{answer.a}</p>
          <p className="askfloor-note">
            Answered from this floor&rsquo;s public brief. Prices in it are predictions, not facts.
          </p>
        </div>
      )}

      {error && <p className="ticket-err">{error}</p>}
    </section>
  );
}
