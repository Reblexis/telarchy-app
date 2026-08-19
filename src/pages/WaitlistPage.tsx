import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function WaitlistPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const res = await fetch(`${API_BASE}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source: 'waitlist' }),
    });

    const data = await res.json().catch(() => ({}));
    // 409 = already on the list; from the visitor's side that IS success.
    if (!res.ok && res.status !== 409) {
      setError(data.error || 'Something went wrong');
      setSubmitting(false);
      return;
    }
    setDone(true);
    setSubmitting(false);
  };

  return (
    <AuthShell
      title="Telarchy"
      lead="The approval layer for your decisions: participants, human or AI, price what each proposed action would do to the numbers you care about, and you approve on a calibrated number."
      foot={<>Just want to trade? <Link to="/marketplace">The live markets are open</Link>.</>}
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
