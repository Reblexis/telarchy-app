import { useState, FormEvent } from 'react';
import { Logo } from '../components/Logo';

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
      body: JSON.stringify({ email }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Something went wrong');
      setSubmitting(false);
      return;
    }
    setDone(true);
    setSubmitting(false);
  };

  return (
    <>
      <div style={{ position: 'fixed', top: '1rem', left: '1rem', zIndex: 1000 }}>
        <Logo variant="lockup" height="5.25rem" />
      </div>
      <div className="login-page">
        <div className="container" style={{ maxWidth: 420 }}>
          <h1>Telarchy</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
            The approval layer for your decisions: participants, human or AI, price what each proposed action would do to the numbers you care about, and you approve on a calibrated number. Leave an email and we will set you up within a few days, for a company or a personal goal.
          </p>
          {done ? (
            <div className="message show" style={{ background: 'var(--success-bg)', color: 'var(--success-text)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
              Got it. We will get back to you within a few days.
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  type="email"
                  id="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <button type="submit" disabled={submitting} style={{ width: '100%' }}>
                {submitting ? 'Sending…' : 'Get set up'}
              </button>
              {error && <div className="error show" style={{ marginTop: '0.75rem' }}>{error}</div>}
            </form>
          )}
        </div>
      </div>
    </>
  );
}
