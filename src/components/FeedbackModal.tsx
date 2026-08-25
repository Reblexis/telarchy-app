import { type FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { FloorModal } from './FloorModal';

type Kind = 'bug' | 'help' | 'feedback';

interface Props {
  open: boolean;
  defaultKind?: Kind;
  onClose: () => void;
}

const KIND_LABELS: Record<Kind, string> = {
  bug: 'Report a bug',
  help: 'Ask for help',
  feedback: 'Share feedback',
};

/**
 * Feedback / bug report, in the same floor style as the Import Manifold
 * dialog (owner ask 2026-08-12: keep the two consistent) - a FloorModal with
 * the ticket header, ticket-label fields, and a single ticket-go verb.
 */
export function FeedbackModal({ open, defaultKind = 'bug', onClose }: Props) {
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (open) {
      setKind(defaultKind);
      setSubject('');
      setBody('');
      setEmail('');
      setError('');
      setSuccess(false);
    }
  }, [open, defaultKind]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!subject.trim() || !body.trim()) {
      setError('Please fill in both fields.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const url = `${location.pathname}${location.search}`;
      await api.submitFeedback({
        kind,
        subject: subject.trim(),
        body: body.trim(),
        url,
        email: email.trim() || undefined,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const kindWord = kind === 'help' ? 'help request' : kind === 'feedback' ? 'feedback' : 'bug report';

  return (
    <FloorModal onClose={onClose} label={KIND_LABELS[kind]}>
      <div className="mfimport">
        <div className="ticket-head mfimport-head">
          <h3 className="mfimport-title">{KIND_LABELS[kind]}</h3>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {success ? (
          <>
            <p className="mfimport-done">
              Thanks. Your {kindWord} was received.
              {email ? (
                <> We&rsquo;ll follow up at {email} if needed.</>
              ) : (
                <> Leave a reply-to email next time if you&rsquo;d like a response.</>
              )}
            </p>
            <button type="button" className="ticket-go is-placed" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="jobform-field">
              <span className="ticket-label">Type</span>
              <select className="jobform-line" value={kind} onChange={e => setKind(e.target.value as Kind)}>
                <option value="bug">Bug report</option>
                <option value="help">Help request</option>
                <option value="feedback">General feedback</option>
              </select>
            </label>

            <label className="jobform-field">
              <span className="ticket-label">Subject</span>
              <input
                className="jobform-line"
                type="text"
                required
                maxLength={200}
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={
                  kind === 'bug'
                    ? 'Short summary of the issue'
                    : kind === 'help'
                      ? 'What do you need help with?'
                      : 'What is on your mind?'
                }
              />
            </label>

            <label className="jobform-field">
              <span className="ticket-label">Details</span>
              <textarea
                className="jobform-line jobform-line--desc"
                required
                rows={5}
                maxLength={10000}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={
                  kind === 'bug'
                    ? 'Steps to reproduce, what you expected, what happened.'
                    : kind === 'help'
                      ? 'Tell us what you are trying to do and what you have tried.'
                      : 'Tell us what could be better.'
                }
              />
            </label>

            <label className="jobform-field">
              <span className="ticket-label">Reply-to email (optional)</span>
              <input
                className="jobform-line"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Defaults to your account email"
              />
            </label>

            {error && <p className="ticket-err">{error}</p>}

            <button type="submit" className="ticket-go" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send'}
            </button>
          </form>
        )}
      </div>
    </FloorModal>
  );
}
