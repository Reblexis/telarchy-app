import { useState } from 'react';
import { api } from '../lib/api';

export type QuestionValues = Record<'option' | 'workspace' | 'metric' | 'date', string>;
export const DEFAULT_OPTION_QUESTION = "With {option}, what will {workspace}'s {metric} be {date}?";
/** One substitution pass: values are data, never templates or markup. */
export function formatOptionQuestion(template: string, values: QuestionValues): string {
  return template.replace(/\{(option|workspace|metric|date)\}/g, (_, key: keyof QuestionValues) => values[key]);
}

export function QuestionWording({
  workspaceId,
  value,
  values,
  canManage,
  onSaved,
}: {
  workspaceId: string;
  value?: string | null;
  values: QuestionValues;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!canManage) return null;
  if (!editing)
    return (
      <button
        type="button"
        className="pubws-know-edit"
        onClick={() => {
          setDraft(value ?? DEFAULT_OPTION_QUESTION);
          setError('');
          setEditing(true);
        }}
      >
        Edit question wording
      </button>
    );
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.updateWorkspaceSettings(workspaceId, { optionQuestionTemplate: draft.trim() || null });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save wording');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="pubws-know-editor" aria-label="Workspace question settings">
      <label className="jobform-field">
        <span className="ticket-label">Workspace question wording</span>
        <textarea
          className="jobform-line jobform-line--desc"
          aria-label="Workspace question wording"
          value={draft}
          maxLength={500}
          rows={3}
          disabled={busy}
          onChange={e => setDraft(e.target.value)}
        />
      </label>
      <p className="odlg-note-left">
        {
          'Applies to all option questions in this workspace. Use {option}, {workspace}, {metric} and {date}. Include {option}; leave blank to restore the default.'
        }
      </p>
      <p aria-label="Question preview">{formatOptionQuestion(draft.trim() || DEFAULT_OPTION_QUESTION, values)}</p>
      {error && (
        <p className="ticket-err" role="alert">
          {error}
        </p>
      )}
      <div className="pubws-know-editor-actions">
        <button type="button" className="ticket-go" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save wording'}
        </button>
        <button type="button" className="pubws-ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </section>
  );
}
