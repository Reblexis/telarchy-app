import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setActiveWorkspace } from '../lib/api';
import { clearCache } from '../lib/cache';
import { useAuth } from '../hooks/useAuth';
import { Logo } from '../components/Logo';
import { TEMPLATES, CURRENCIES, type TemplateId, type TemplateInfo } from '../lib/workspace-templates';
import type { Metric } from '../types';

/**
 * The cinematic first-run canvas (owner decision, 2026-07-13): a full-screen,
 * near-zero-text, one-action-per-beat welcome sequence that ends by dropping
 * the user into their real, populated workspace. Premium-minimal motion; no
 * badges or gamification. Replaces the persona-picker + coach-tour for
 * brand-new browser users (existing users adding a workspace keep the quick
 * /create-workspace form).
 *
 * Beats: intent -> template -> name (creates the workspace) -> calibrate
 * (set current values with live gauges) -> loop (a concept slider that shows
 * how a decision gets priced) -> into the workspace.
 */

type Beat = 'intent' | 'template' | 'name' | 'calibrate' | 'loop';
const PROGRESS_BEATS: Beat[] = ['template', 'name', 'calibrate', 'loop'];

function isLeaf(m: Metric): boolean {
  return !m.formula || m.formula.trim() === '0';
}

const fmt = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);

interface CreatedWorkspace {
  id: string;
  slug?: string | null;
  ownerHandle?: string | null;
}

export function WelcomePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  const [beat, setBeat] = useState<Beat>('intent');
  const [selected, setSelected] = useState<TemplateId | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [revenueRangeMax, setRevenueRangeMax] = useState(100000);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [ws, setWs] = useState<CreatedWorkspace | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [slider, setSlider] = useState<number | null>(null);
  const [dragged, setDragged] = useState(false);

  useEffect(() => {
    document.body.classList.add('landing-page');
    return () => document.body.classList.remove('landing-page');
  }, []);

  // Not signed in: this canvas is only reachable post-signup.
  useEffect(() => {
    if (!loading && !user) navigate('/signup?next=/welcome', { replace: true });
  }, [loading, user, navigate]);

  const tpl: TemplateInfo | null = selected ? TEMPLATES.find(t => t.id === selected) ?? null : null;
  const leaves = useMemo(() => metrics.filter(isLeaf), [metrics]);
  const headline = useMemo(() => {
    if (leaves.length === 0) return null;
    return [...leaves].sort((a, b) => (b.marketRangeMax ?? 1000) - (a.marketRangeMax ?? 1000))[0];
  }, [leaves]);

  // ── Intent ────────────────────────────────────────────────────────────────
  const pickIntent = (intent: 'creator' | 'trader' | 'agent') => {
    // Persist so the in-app persona picker recovers this and never re-asks.
    api.upsertProfile({ intent }).catch(e => console.error('welcome: upsertProfile failed', e));
    if (intent === 'trader') { navigate('/marketplace'); return; }
    if (intent === 'agent') { navigate('/api-access'); return; }
    setBeat('template');
  };

  // ── Template ────────────────────────────────────────────────────────────────
  const pickTemplate = (id: TemplateId) => {
    setSelected(id);
    const info = id === 'blank' ? null : TEMPLATES.find(t => t.id === id) ?? null;
    setRevenueRangeMax(info?.revenueScale?.default ?? 100000);
    // Templates that need a currency/scale reveal an inline mini-config and
    // wait; everything else advances on the single tap.
    if (!info || (!info.needsCurrency && !info.revenueScale)) setBeat('name');
  };

  // ── Name -> create ──────────────────────────────────────────────────────────
  const create = async () => {
    if (!selected || !name.trim() || creating) return;
    setError('');
    setCreating(true);
    try {
      const templateParams: { revenueRangeMax?: number; currency?: string } = {};
      if (tpl?.needsCurrency) templateParams.currency = currency;
      if (tpl?.revenueScale) templateParams.revenueRangeMax = revenueRangeMax;
      const created = await api.createWorkspace({
        name: name.trim(),
        template: selected,
        templateParams: Object.keys(templateParams).length > 0 ? templateParams : undefined,
        visibility: 'public',
      }) as CreatedWorkspace;
      setActiveWorkspace(created.id);
      // Open access: the Public group trades, so the platform forecaster pool
      // starts pricing the workspace within minutes (mirrors CreateWorkspacePage).
      try {
        const groups = await api.listGroups() as Array<{ id: string; type: string; capabilities?: string[] }>;
        const pub = groups.find(g => g.type === 'public');
        if (pub) {
          const caps = Array.from(new Set([...(pub.capabilities ?? []), 'read', 'trade']));
          await api.updateGroup(pub.id, { capabilities: caps });
        }
      } catch (e) { console.error('welcome: public group update failed', e); }
      clearCache();
      const ms = await api.getMetrics() as Metric[];
      setWs(created);
      setMetrics(ms);
      const init: Record<string, string> = {};
      for (const m of ms) if (isLeaf(m)) init[m.id] = String(m.value);
      setValues(init);
      // Blank template: nothing to calibrate, nothing to price. Straight in.
      if (ms.some(isLeaf)) setBeat('calibrate');
      else gotoWorkspace(created);
    } catch (err) {
      setError((err as Error).message || 'Could not create your workspace');
      setCreating(false);
    }
  };

  // ── Calibrate (save a value, live) ──────────────────────────────────────────
  const saveValue = async (m: Metric, raw: string) => {
    const v = parseFloat(raw);
    if (isNaN(v) || v === m.value) return;
    try {
      await api.updateMetric(m.id, {
        name: m.name, description: m.description || '', value: v,
        formula: m.formula || '0', oldValue: m.value, updateNote: 'Check-in',
        timePreference: m.timePreference ?? null, marketRangeMax: m.marketRangeMax,
      });
      setMetrics(prev => prev.map(x => x.id === m.id ? { ...x, value: v } : x));
      setSavedIds(prev => ({ ...prev, [m.id]: true }));
      window.setTimeout(() => setSavedIds(prev => { const { [m.id]: _, ...rest } = prev; return rest; }), 1800);
    } catch (e) { console.error('welcome: saveValue failed', e); }
  };

  const gotoWorkspace = (w: CreatedWorkspace | null) => {
    const path = w?.ownerHandle && w?.slug
      ? `/${encodeURIComponent(w.ownerHandle)}/${encodeURIComponent(w.slug)}/metrics`
      : '/metrics';
    // Full reload so the sidebar/workspace hooks re-fetch from a clean slate.
    window.location.href = path;
  };
  const enterWorkspace = () => gotoWorkspace(ws);

  if (loading || !user) return <div className="loading">Loading...</div>;

  const dotIndex = PROGRESS_BEATS.indexOf(beat);

  return (
    <div className="wc-root">
      <header className="wc-top">
        <Logo variant="lockup" height="2rem" />
        {(beat === 'calibrate' || beat === 'loop') && (
          <button type="button" className="wc-skip" onClick={enterWorkspace}>Skip for now</button>
        )}
      </header>

      <main className="wc-main">
        <div className="wc-stage" key={beat}>
          {beat === 'intent' && (
            <section className="wc-beat">
              <div className="wc-eyebrow">Welcome</div>
              <h1 className="wc-title">What brings you here?</h1>
              <div className="wc-cards wc-cards-lg">
                <button type="button" className="wc-card" onClick={() => pickIntent('creator')}>
                  <span className="wc-card-glyph">◎</span>
                  <span className="wc-card-title">Improve my decisions</span>
                  <span className="wc-card-sub">Track what matters. Price each move. Approve on a number.</span>
                </button>
                <button type="button" className="wc-card" onClick={() => pickIntent('trader')}>
                  <span className="wc-card-glyph">▟</span>
                  <span className="wc-card-title">Trade &amp; forecast</span>
                  <span className="wc-card-sub">Predict real metrics. Earn credits by being right.</span>
                </button>
                <button type="button" className="wc-card" onClick={() => pickIntent('agent')}>
                  <span className="wc-card-glyph">⌘</span>
                  <span className="wc-card-title">Build an AI participant</span>
                  <span className="wc-card-sub">Plug an agent into the API.</span>
                </button>
              </div>
            </section>
          )}

          {beat === 'template' && (
            <section className="wc-beat">
              <button type="button" className="wc-back" onClick={() => { setSelected(null); setBeat('intent'); }}>← Back</button>
              <h1 className="wc-title">What matters to you?</h1>
              <div className="wc-grid">
                {TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`wc-tile${selected === t.id ? ' wc-tile-on' : ''}`}
                    onClick={() => pickTemplate(t.id)}
                  >
                    <span className="wc-tile-glyph">{t.glyph}</span>
                    <span className="wc-tile-label">{t.label}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className={`wc-tile wc-tile-blank${selected === 'blank' ? ' wc-tile-on' : ''}`}
                  onClick={() => pickTemplate('blank')}
                >
                  <span className="wc-tile-glyph">+</span>
                  <span className="wc-tile-label">Start from scratch</span>
                </button>
              </div>

              {tpl && (tpl.needsCurrency || tpl.revenueScale) && (
                <div className="wc-config">
                  {tpl.needsCurrency && (
                    <label className="wc-field">
                      <span>Currency</span>
                      <select value={currency} onChange={e => setCurrency(e.target.value)}>
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                  )}
                  {tpl.revenueScale && (
                    <label className="wc-field">
                      <span>{tpl.revenueScale.label}{tpl.needsCurrency ? ` (${currency})` : ''}</span>
                      <input
                        type="number" min={1} step={1} value={revenueRangeMax}
                        onChange={e => setRevenueRangeMax(Math.max(1, Number(e.target.value) || 0))}
                      />
                    </label>
                  )}
                  <button type="button" className="wc-cta" onClick={() => setBeat('name')}>Continue</button>
                </div>
              )}
            </section>
          )}

          {beat === 'name' && (
            <section className="wc-beat wc-beat-center">
              {!creating && (
                <button type="button" className="wc-back" onClick={() => setBeat('template')}>← Back</button>
              )}
              {creating ? (
                <div className="wc-building">
                  <div className="wc-building-orb" aria-hidden="true" />
                  <h1 className="wc-title">Building your workspace…</h1>
                  <p className="wc-sub">Seeding metrics and opening markets.</p>
                </div>
              ) : (
                <>
                  <h1 className="wc-title">Name it.</h1>
                  <input
                    className="wc-name-input"
                    autoFocus
                    maxLength={80}
                    placeholder={tpl?.category === 'personal' ? 'e.g. My 2026' : 'e.g. Moonshot Labs'}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') create(); }}
                  />
                  <button type="button" className="wc-cta wc-cta-wide" disabled={!name.trim()} onClick={create}>
                    Create workspace
                  </button>
                  <p className="wc-sub">You can change anything later.</p>
                  {error && <div className="wc-error">{error}</div>}
                </>
              )}
            </section>
          )}

          {beat === 'calibrate' && (
            <section className="wc-beat">
              <h1 className="wc-title">Where are you now?</h1>
              <p className="wc-sub">Real numbers. Your forecasts build from here.</p>
              <div className="wc-metrics">
                {leaves.map(m => {
                  const max = m.marketRangeMax ?? 1000;
                  const v = parseFloat(values[m.id] ?? '') || 0;
                  const pct = Math.max(0, Math.min(1, max > 0 ? v / max : 0)) * 100;
                  return (
                    <div className="wc-metric" key={m.id}>
                      <div className="wc-metric-head">
                        <span className="wc-metric-name">{m.name}</span>
                        {savedIds[m.id] && <span className="wc-saved">saved</span>}
                      </div>
                      <input
                        className="wc-metric-input"
                        type="number"
                        inputMode="decimal"
                        value={values[m.id] ?? ''}
                        onChange={e => setValues(prev => ({ ...prev, [m.id]: e.target.value }))}
                        onBlur={e => saveValue(m, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      />
                      <div className="wc-gauge"><div className="wc-gauge-fill" style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="wc-cta wc-cta-wide"
                onClick={() => {
                  // Persist any still-focused edits, then advance.
                  for (const m of leaves) { const raw = values[m.id] ?? ''; if (parseFloat(raw) !== m.value) saveValue(m, raw); }
                  if (headline) { setSlider(headline.value); setBeat('loop'); } else { enterWorkspace(); }
                }}
              >
                Continue
              </button>
            </section>
          )}

          {beat === 'loop' && headline && (
            <section className="wc-beat wc-beat-center">
              <div className="wc-eyebrow">The idea</div>
              <h1 className="wc-title">Every move, priced against this.</h1>
              <p className="wc-sub">Drag where you think <strong>{headline.name}</strong> is heading.</p>
              <div className="wc-slider-readout">{fmt(slider ?? headline.value)}</div>
              <input
                className="wc-slider"
                type="range"
                min={0}
                max={headline.marketRangeMax ?? 1000}
                step={Math.max(1, Math.round((headline.marketRangeMax ?? 1000) / 100))}
                value={slider ?? headline.value}
                onChange={e => { setSlider(Number(e.target.value)); setDragged(true); }}
              />
              <div className="wc-gauge wc-gauge-wide">
                <div
                  className="wc-gauge-fill"
                  style={{ width: `${Math.max(0, Math.min(1, (slider ?? headline.value) / (headline.marketRangeMax || 1000))) * 100}%` }}
                />
              </div>
              <p className={`wc-reveal${dragged ? ' wc-reveal-on' : ''}`}>
                That is a forecast. On Telarchy, participants (human or AI) forecast every proposed action against your
                metrics, and you approve on where they land, not on a pitch.
              </p>
              <button type="button" className="wc-cta wc-cta-wide" onClick={enterWorkspace}>
                Enter your workspace
              </button>
            </section>
          )}
        </div>

        {dotIndex >= 0 && (
          <div className="wc-dots" aria-hidden="true">
            {PROGRESS_BEATS.map((b, i) => (
              <span key={b} className={`wc-dot${i === dotIndex ? ' wc-dot-on' : ''}${i < dotIndex ? ' wc-dot-done' : ''}`} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
