import { useState, FormEvent } from 'react';

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
        <img src="/logo_transparent_bg.png" alt="Telarchy" style={{ height: '5.25rem' }} />
      </div>
      <div className="login-page">
        <div className="container" style={{ maxWidth: 420 }}>
          <h1>Telarchy</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
            Metrics governance with prediction markets and AI agents. Join the waitlist to get early access.
          </p>
          {done ? (
            <div className="message show" style={{ background: 'var(--success-bg)', color: 'var(--success-text)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
              You're on the list. We'll be in touch.
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
                {submitting ? 'Joining...' : 'Join the waitlist'}
              </button>
              {error && <div className="error show" style={{ marginTop: '0.75rem' }}>{error}</div>}
            </form>
          )}
        </div>
      </div>
    </>
  );
}
