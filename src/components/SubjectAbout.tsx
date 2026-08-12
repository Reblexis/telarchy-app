import { useState } from 'react';
import { api } from '../lib/api';

/**
 * The "What is <name>?" section on the public floor: the owner's own words
 * about the company/subject the market is on, plus sources. Free text,
 * owner-editable (owner ask 2026-08-12). Falls back to the floor's built-in
 * default copy until the owner writes their own. URLs render as links; line
 * breaks are preserved, so a "Sources:" list reads the way it was typed.
 */

function linkify(text: string) {
  // Split on URLs, keeping them (capturing group), then wrap the URL parts.
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a>
      : <span key={i}>{part}</span>,
  );
}

export function SubjectAbout({ workspaceId, name, value, defaultText, canManage, onSaved }: {
  workspaceId: string;
  name: string;
  value: string | null | undefined;
  defaultText: string;
  canManage: boolean;
  onSaved: () => void;
}) {
  const text = value && value.trim() ? value : defaultText;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true); setErr('');
    try {
      // Empty clears back to the default copy (subjectAbout = null).
      await api.updateWorkspaceSettings(workspaceId, { subjectAbout: draft.trim() || null });
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr((e as Error).message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pubws-know pubws-enter pubws-enter--3" aria-label={`What is ${name}`}>
      <div className="pubws-know-headrow">
        <h2 className="pubws-know-head">What is {name}?</h2>
        {canManage && !editing && (
          <button className="pubws-know-edit" onClick={() => { setDraft(text); setErr(''); setEditing(true); }}>Edit</button>
        )}
      </div>

      {editing ? (
        <div className="pubws-know-editor">
          <textarea
            className="jobform-line jobform-line--desc pubws-know-editarea"
            rows={12}
            maxLength={4000}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            aria-label={`What is ${name}?`}
          />
          {err && <p className="ticket-err">{err}</p>}
          <div className="pubws-know-editor-actions">
            <button className="ticket-go" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="pubws-ghost" onClick={() => { setEditing(false); setErr(''); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="pubws-know-what pubws-know-about">{linkify(text)}</p>
      )}
    </section>
  );
}
