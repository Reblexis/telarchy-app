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
 * So this sits in the decision column, directly under the bet buttons and
 * above the conversation, not in a corner bubble: a corner bubble reads as
 * support ("having trouble?"), and this is research ("before you price it").
 * The answer comes from GET /api/marketplace/:id/context and nothing else,
 * which is the same brief the "point your own agent here" panel hands out,
 * because a visitor and their bot should be reading the same facts.
 */

interface Props {
  idOrSlug: string;
  workspaceName: string;
  /** The number the floor leads with, used for one suggested question. */
  metricLabel: string | null;
}

/** The prompt a visitor hands their own agent. Built from this floor, so it
 *  is copy-paste-runnable rather than a template with blanks to fill. */
function agentPrompt(idOrSlug: string, workspaceName: string): string {
  const base = `${window.location.origin}/api/marketplace/${idOrSlug}`;
  return [
    `You are researching ${workspaceName} on Telarchy, where a market prices what each proposed contract would do to the company's real numbers.`,
    '',
    `1. Read the brief: GET ${base}/context?format=md`,
    '   It carries the company, every metric with its history, the open markets and their current prices, every contract with the market\'s priced impact, and the owner\'s published documents. Drop ?format=md for JSON.',
    `2. The endpoint catalog is GET ${window.location.origin}/api/help. Registering a participant and placing trades are documented there.`,
    '',
    'Then answer my questions about this company using only that brief, and tell me when something is not in it. Treat market prices as predictions, not facts.',
  ].join('\n');
}

export function AskFloor({ idOrSlug, workspaceName, metricLabel }: Props) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const copyPrompt = () => {
    navigator.clipboard.writeText(agentPrompt(idOrSlug, workspaceName)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(e => console.error('copy failed:', e));
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

      <div className="askfloor-agent">
        <button type="button" className="askfloor-link" onClick={() => setPromptOpen(o => !o)} aria-expanded={promptOpen}>
          {promptOpen ? 'Hide the agent prompt' : 'Point your own AI at this floor'}
        </button>
        {promptOpen && (
          <div className="askfloor-prompt">
            <pre className="askfloor-prompt-text">{agentPrompt(idOrSlug, workspaceName)}</pre>
            <button type="button" className="askfloor-copy" onClick={copyPrompt}>
              {copied ? 'Copied' : 'Copy prompt'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
