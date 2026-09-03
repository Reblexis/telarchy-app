import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * The Manifold update card (docs/manifold-update.md): the standings comment
 * the owner posts on the recruiting market, as the server wrote it. Read-only,
 * because the wording is the doc's; he copies it and posts it himself.
 */
export function ManifoldUpdate() {
  const [text, setText] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setError('');
    setCopied(false);
    api
      .manifoldUpdate()
      .then(r => {
        setText(r.text);
        setGeneratedAt(r.generatedAt);
      })
      .catch(e => {
        setText(null);
        setError((e as Error).message || 'Could not read the update');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copy = () => {
    if (text === null) return;
    const done = () => setCopied(true);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(done, () => setError('Could not copy; select the text and copy it yourself'));
    } else {
      setError('Could not copy; select the text and copy it yourself');
    }
  };

  return (
    <section className="adm-block">
      <h2 className="pubws-h2">Manifold update</h2>
      <p className="adm-note">
        The standings comment for the recruiting market, read fresh from the season standings and the linked count. Copy
        it and post it yourself; nothing here posts to Manifold.
      </p>
      {error && <p className="adm-err">{error}</p>}
      {text === null && !error && <p className="adm-empty">Loading&hellip;</p>}
      {text !== null && (
        <>
          <textarea className="xw-paste mu-text" aria-label="Manifold update" value={text} readOnly />
          <div className="mu-actions">
            <button type="button" className="adm-paygo" onClick={copy}>
              Copy
            </button>
            <button type="button" className="adm-paygo" onClick={load}>
              Refresh
            </button>
            {copied && <span className="mu-done">Copied</span>}
            {generatedAt && <span className="mu-done">as of {new Date(generatedAt).toLocaleTimeString()}</span>}
          </div>
        </>
      )}
    </section>
  );
}
