import { useState, useEffect, FormEvent, CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setActiveWorkspace } from '../lib/api';
import { clearCache } from '../lib/cache';
import { useAuth } from '../hooks/useAuth';
import { TEMPLATES, CURRENCIES, type TemplateId, type TemplateCategory } from '../lib/workspace-templates';

type Category = TemplateCategory;

const cardStyle: CSSProperties = {
  padding: '0.75rem 1rem',
  borderRadius: '0.5rem',
  fontSize: '0.95rem',
  cursor: 'pointer',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  textAlign: 'left',
  transition: 'border-color 0.15s',
};

const blankCardStyle: CSSProperties = {
  ...cardStyle,
  borderStyle: 'dashed',
  background: 'transparent',
  color: 'var(--text-secondary)',
};

function clickable(onPick: () => void, extra: CSSProperties = {}): React.HTMLAttributes<HTMLDivElement> & { style: CSSProperties; tabIndex: number; role: string } {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onPick,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } },
    onMouseEnter: (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--focus-border)'; },
    onMouseLeave: (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-color)'; },
    style: { ...cardStyle, ...extra },
  };
}

export function CreateWorkspacePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Trader-first (vision.md, 2026-08-08): workspace creation is invite-only,
  // so only platform admins reach this form; everyone else lands on the
  // owner waitlist. The backend enforces the same gate on POST /api/workspaces.
  useEffect(() => {
    if (!user) return;
    api.getProfile()
      .then((p: { platformAdmin?: boolean }) => {
        if (p.platformAdmin !== true) navigate('/manage', { replace: true });
      })
      .catch(e => { console.error('profile check failed:', e); navigate('/manage', { replace: true }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const [step, setStep] = useState<'category' | 'template' | 'config'>('category');
  const [category, setCategory] = useState<Category | null>(null);
  const [selected, setSelected] = useState<TemplateId | null>(null);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [revenueRangeMax, setRevenueRangeMax] = useState<number>(100000);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const tpl = selected ? TEMPLATES.find(t => t.id === selected) ?? null : null;

  const pickTemplate = (id: TemplateId) => {
    setSelected(id);
    const info = TEMPLATES.find(t => t.id === id);
    setRevenueRangeMax(info?.revenueScale?.default ?? 100000);
    setStep('config');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !selected) return;
    setError('');
    setSubmitting(true);

    try {
      const templateParams: { revenueRangeMax?: number; currency?: string } = {};
      if (tpl?.needsCurrency) templateParams.currency = currency;
      if (tpl?.revenueScale) templateParams.revenueRangeMax = revenueRangeMax;

      // New workspaces default to "Open" access: listed on the marketplace and
      // the Public group gets the 'trade' capability. Owners can flip this in
      // Settings. Rationale: get first users to "agents trading on my metrics"
      // with zero decisions at signup.
      const ws = await api.createWorkspace({
        name: name.trim(),
        template: selected,
        templateParams: Object.keys(templateParams).length > 0 ? templateParams : undefined,
        visibility: 'public',
      });
      setActiveWorkspace(ws.id);
      const groups = await api.listGroups() as Array<{ id: string; type: string; capabilities?: string[] }>;
      const pub = groups.find(g => g.type === 'public');
      if (pub) {
        const caps = Array.from(new Set([...(pub.capabilities ?? []), 'read', 'trade']));
        await api.updateGroup(pub.id, { capabilities: caps });
      }
      clearCache();
      // Full reload so useWorkspace re-fetches the workspace list and profile
      // from scratch. A soft navigate leaves stale state in the sidebar.
      window.location.href = '/check-in?welcome=1';
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to create workspace');
      setSubmitting(false);
    }
  };

  const nav = (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      padding: '1rem 2rem', borderBottom: '1px solid var(--border-color)',
    }}>
      <Link to="/" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
        ← Back
      </Link>
    </nav>
  );

  const blankCard = (
    <div {...clickable(() => pickTemplate('blank'), blankCardStyle)} aria-label="Start from scratch">
      <div style={{ fontWeight: 500 }}>Start from scratch</div>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginTop: '0.15rem' }}>
        No metrics. Define your own from the Metrics page.
      </div>
    </div>
  );

  if (step === 'category') {
    return (
      <>
        {nav}
        <div className="login-page">
          <div className="container" style={{ maxWidth: 420 }}>
            <h1>What do you want to track?</h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1.5rem' }}>
              <div {...clickable(() => { setCategory('startup'); setStep('template'); })}>
                <div style={{ fontWeight: 500 }}>My startup or company</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                  Pick a company type next. Metrics are objective and externally verifiable.
                </div>
              </div>
              <div {...clickable(() => { setCategory('personal'); setStep('template'); })}>
                <div style={{ fontWeight: 500 }}>My personal goals</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                  Pick a life area next. Subjective metrics are explicitly labeled self-reported.
                </div>
              </div>
              {blankCard}
            </div>
          </div>
        </div>
      </>
    );
  }

  if (step === 'template' && category) {
    const list = TEMPLATES.filter(t => t.category === category);
    return (
      <>
        {nav}
        <div className="login-page">
          <div className="container" style={{ maxWidth: 460 }}>
            <button
              type="button"
              onClick={() => { setCategory(null); setStep('category'); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.82rem', padding: 0, marginBottom: '1rem' }}
            >
              ← Back
            </button>
            <h1>{category === 'startup' ? 'Pick a company type' : 'Pick a life area'}</h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              You can edit, add, or remove metrics after the workspace is created.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1.5rem' }}>
              {list.map(t => (
                <div key={t.id} {...clickable(() => pickTemplate(t.id))}>
                  <div style={{ fontWeight: 500 }}>{t.label}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{t.blurb}</div>
                </div>
              ))}
              {blankCard}
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {nav}
      <div className="login-page">
        <div className="container" style={{ maxWidth: 420 }}>
          <button
            type="button"
            onClick={() => setStep(category ? 'template' : 'category')}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.82rem', padding: 0, marginBottom: '1rem' }}
          >
            ← Back
          </button>
          <h1>Name your workspace</h1>
          {tpl && tpl.id !== 'blank' && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Template: <strong>{tpl.label}</strong>. {tpl.blurb}
            </p>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <input
                type="text"
                id="ws-name"
                required
                autoFocus
                maxLength={80}
                placeholder="e.g. Moonshot Labs"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            {tpl?.needsCurrency && (
              <div className="form-group">
                <label htmlFor="ws-currency">Currency</label>
                <select id="ws-currency" value={currency} onChange={e => setCurrency(e.target.value)}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {tpl?.revenueScale && (
              <div className="form-group">
                <label htmlFor="rev-max">
                  {tpl.revenueScale.label}{tpl.needsCurrency ? ` (${currency})` : ''}
                </label>
                <input
                  type="number"
                  id="rev-max"
                  min={1}
                  step={1}
                  value={revenueRangeMax}
                  onChange={e => setRevenueRangeMax(Math.max(1, Number(e.target.value) || 0))}
                />
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                  Sets the upper bound of the prediction market for this metric. Pick a number you would consider an extraordinary success.
                </div>
              </div>
            )}

            <button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? 'Creating...' : 'Create workspace'}
            </button>
            {error && <div className="error show">{error}</div>}
          </form>
        </div>
      </div>
    </>
  );
}
