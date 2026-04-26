import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { TaskProposal } from '../types';

function PendingTasksQueue() {
  const [pending, setPending] = useState<TaskProposal[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.getTasks('pending')
      .then((rows: TaskProposal[]) => { if (!cancelled) setPending(rows); })
      .catch(() => { if (!cancelled) setPending([]); });
    return () => { cancelled = true; };
  }, []);
  if (!pending || pending.length === 0) return null;
  return (
    <div style={{
      width: '100%', maxWidth: 620, marginBottom: '2.5rem',
      border: '1px solid var(--border-color)', borderRadius: '0.75rem',
      background: 'var(--bg-secondary)', padding: '1.25rem 1.5rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
          Awaiting your decision
        </strong>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
          {pending.length} pending
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {pending.slice(0, 5).map(t => (
          <Link
            key={t.id}
            to={`/tasks?id=${t.id}`}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.55rem 0.75rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              textDecoration: 'none', color: 'var(--text-primary)',
              fontSize: '0.875rem',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--focus-border)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '0.75rem' }}>
              {t.title}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', flexShrink: 0 }}>
              ${t.price.toFixed(2)}
            </span>
          </Link>
        ))}
      </div>
      {pending.length > 5 && (
        <Link to="/tasks" style={{ display: 'block', marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
          View all {pending.length} pending →
        </Link>
      )}
    </div>
  );
}

export function StartPage() {
  return (
    <>
      <div style={{
        minHeight: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '3rem 2rem',
      }}>
        <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', letterSpacing: '-0.03em', marginBottom: '0.5rem', textAlign: 'center' }}>
          What do you want to start with?
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '2.5rem', textAlign: 'center' }}>
          You can always do both - this just picks where you land first.
        </p>

        <PendingTasksQueue />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem', width: '100%', maxWidth: 620 }}>

          <Link to="/create-workspace" style={{ textDecoration: 'none' }}>
            <div style={{
              border: '1px solid var(--border-color)', borderRadius: '0.75rem',
              padding: '1.75rem', background: 'var(--bg-secondary)',
              cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
              display: 'flex', flexDirection: 'column', gap: '0.6rem',
              height: '100%',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--focus-border)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
            >
              <span style={{ fontSize: '1.5rem' }}>📊</span>
              <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>Make better decisions</strong>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                Create a workspace, set up your goals as metrics, and get AI forecasts
                on where each one is heading.
              </p>
            </div>
          </Link>

          <Link to="/marketplace" style={{ textDecoration: 'none' }}>
            <div style={{
              border: '1px solid var(--border-color)', borderRadius: '0.75rem',
              padding: '1.75rem', background: 'var(--bg-secondary)',
              cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
              display: 'flex', flexDirection: 'column', gap: '0.6rem',
              height: '100%',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--focus-border)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
            >
              <span style={{ fontSize: '1.5rem' }}>🤖</span>
              <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>Forecast on public markets</strong>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                Browse live markets across public workspaces, join one, and start forecasting,
                manually or by connecting an automated participant.
              </p>
            </div>
          </Link>
        </div>
      </div>
    </>
  );
}
