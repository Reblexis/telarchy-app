import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

type Kind = 'bug' | 'help' | 'feedback';
type Status = 'open' | 'triaged' | 'resolved' | 'closed';

interface FeedbackRow {
  id: string;
  kind: Kind;
  subject: string;
  body: string;
  workspaceId: string | null;
  agentId: string | null;
  authUserId: string | null;
  email: string | null;
  url: string | null;
  userAgent: string | null;
  status: Status;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
}

const KIND_COLORS: Record<Kind, string> = {
  bug: '#dc2626',
  help: '#0891b2',
  feedback: '#7c3aed',
};

const STATUSES: Status[] = ['open', 'triaged', 'resolved', 'closed'];

export function FeedbackInbox() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('open');
  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [forbidden, setForbidden] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listFeedback({
        status: statusFilter === 'all' ? undefined : statusFilter,
        kind: kindFilter === 'all' ? undefined : kindFilter,
        limit: 200,
      }) as { items: FeedbackRow[] };
      setRows(data.items);
      setError('');
      setForbidden(false);
    } catch (e) {
      const msg = (e as Error).message;
      if (/forbidden/i.test(msg)) setForbidden(true);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const updateStatus = async (id: string, status: Status) => {
    try {
      await api.updateFeedback(id, { status });
      setRows(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (forbidden) return null;

  return (
    <div className="section" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Feedback inbox</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as Status | 'all')}
            style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '0.85rem' }}
          >
            <option value="all">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={kindFilter}
            onChange={e => setKindFilter(e.target.value as Kind | 'all')}
            style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '0.85rem' }}
          >
            <option value="all">All kinds</option>
            <option value="bug">bug</option>
            <option value="help">help</option>
            <option value="feedback">feedback</option>
          </select>
          <button
            onClick={fetchRows}
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', cursor: 'pointer' }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error show" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '60vh', overflowY: 'auto' }}>
        {rows.length === 0 && !loading ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            No matching feedback.
          </div>
        ) : (
          rows.map(row => {
            const isOpen = expanded[row.id];
            return (
              <div key={row.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 130px 1fr 100px',
                    gap: '0.75rem',
                    alignItems: 'center',
                    padding: '0.55rem 0.75rem',
                    cursor: 'pointer',
                  }}
                  onClick={() => setExpanded(s => ({ ...s, [row.id]: !s[row.id] }))}
                >
                  <span style={{
                    display: 'inline-block',
                    padding: '0.15rem 0.45rem',
                    borderRadius: 'var(--radius-md)',
                    background: KIND_COLORS[row.kind],
                    color: '#fff',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textAlign: 'center',
                  }}>
                    {row.kind}
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                    {new Date(row.createdAt).toLocaleString()}
                  </span>
                  <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.subject}
                  </span>
                  <span style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-secondary)',
                    textAlign: 'right',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>
                    {row.status}
                  </span>
                </div>

                {isOpen && (
                  <div style={{ padding: '0.5rem 1rem 1rem', background: 'var(--bg-secondary)', display: 'grid', gap: '0.5rem' }}>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      {row.body}
                    </div>
                    <div style={{ display: 'grid', gap: '0.2rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      {row.email && <div>Reply-to: {row.email}</div>}
                      {row.url && <div>URL: {row.url}</div>}
                      {row.workspaceId && <div>Workspace: <code>{row.workspaceId}</code></div>}
                      {row.agentId && <div>Participant: <code>{row.agentId}</code></div>}
                      {row.userAgent && <div style={{ wordBreak: 'break-all' }}>UA: {row.userAgent}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {STATUSES.map(s => (
                        <button
                          key={s}
                          onClick={() => updateStatus(row.id, s)}
                          disabled={row.status === s}
                          style={{
                            fontSize: '0.7rem',
                            padding: '0.25rem 0.55rem',
                            border: `1px solid ${row.status === s ? 'var(--accent-color)' : 'var(--border-color)'}`,
                            borderRadius: 'var(--radius-md)',
                            background: row.status === s ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                            color: row.status === s ? '#fff' : 'var(--text-secondary)',
                            cursor: row.status === s ? 'default' : 'pointer',
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
