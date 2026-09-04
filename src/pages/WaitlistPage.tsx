import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { api } from '../lib/api';

export function WaitlistPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      // Already on the list counts as success: the client resolves a 409.
      await api.joinWaitlist({ email, source: 'waitlist' });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Telarchy"
      lead="Leave an email and we set up your workspace with you: which numbers to list, who can trade them, and how the values get in."
      foot={
        <>
          Just want to trade? <Link to="/marketplace">The live markets are open</Link>.
        </>
      }
    >
      {done ? (
        <p className="pubws-pitch">Got it. We will get back to you within a few days.</p>
      ) : (
        <form className="pubws-waitform" onSubmit={handleSubmit}>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email"
          />
          <button className="pubws-cta" type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Get set up'}
          </button>
        </form>
      )}
      {error && <p className="pubws-joinerr">{error}</p>}
    </AuthShell>
  );
}
