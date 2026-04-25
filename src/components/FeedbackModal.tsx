import { useState, useEffect, FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';

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

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal show" onClick={handleOverlayClick}>
      <div className="modal-content" style={{ maxWidth: '32rem' }}>
        <div className="modal-header">
          <h3>{KIND_LABELS[kind]}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {success ? (
          <div style={{ padding: '0.5rem 0 1rem' }}>
            <p style={{ marginBottom: '1rem' }}>
              Thanks. Your {kind === 'help' ? 'help request' : kind === 'feedback' ? 'feedback' : 'bug report'} was received.
              We will follow up at <strong>{email || 'the email on your account'}</strong> if needed.
            </p>
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="feedbackKind">Type</label>
              <select
                id="feedbackKind"
                value={kind}
                onChange={e => setKind(e.target.value as Kind)}
              >
                <option value="bug">Bug report</option>
                <option value="help">Help request</option>
                <option value="feedback">General feedback</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="feedbackSubject">Subject</label>
              <input
                type="text"
                id="feedbackSubject"
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
            </div>

            <div className="form-group">
              <label htmlFor="feedbackBody">Details</label>
              <textarea
                id="feedbackBody"
                required
                rows={6}
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
            </div>

            <div className="form-group">
              <label htmlFor="feedbackEmail">Reply-to email (optional)</label>
              <input
                type="email"
                id="feedbackEmail"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Defaults to your account email"
              />
            </div>

            {error && <div className="message error show" style={{ marginBottom: '0.75rem' }}>{error}</div>}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
