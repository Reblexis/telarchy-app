import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { useInspectMode } from '../hooks/useInspectMode';
import { api } from '../lib/api';
import { formatTargetDateDisplay } from '../lib/date-utils';
import type { TaskProposal, TaskMessage, TaskMarketSummary, TaskDetailData } from '../types';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#22c55e',
  declined: '#ef4444',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="status-badge" style={{
      background: `${STATUS_COLORS[status] ?? '#888'}18`,
      color: STATUS_COLORS[status] ?? '#888',
    }}>
      {status}
    </span>
  );
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '-';
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.005 ? String(rounded) : value.toFixed(2);
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function DeltaCell({ current, baseline }: { current: number | null | undefined; baseline: number | null | undefined }) {
  if (current == null || baseline == null) return <span style={{ color: 'var(--text-secondary)' }}>—</span>;
  const delta = current - baseline;
  if (Math.abs(delta) < 0.005) return <span style={{ color: 'var(--text-secondary)' }}>0</span>;
  return (
    <span style={{ color: delta > 0 ? 'var(--success-text)' : 'var(--error-text)', fontWeight: 600 }}>
      {delta > 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(2)}
    </span>
  );
}

function MarketSummaryTable({ markets }: { markets: TaskMarketSummary[] }) {
  const [showAll, setShowAll] = useState(false);

  if (markets.length === 0) {
    return <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>No impact predictions yet. Click &quot;Inspect&quot; to spawn conditional markets.</p>;
  }

  const nearHorizonCutoff = new Date();
  nearHorizonCutoff.setFullYear(nearHorizonCutoff.getFullYear() + 1);
  const isNear = (targetDate: string) => {
    const year = parseInt(targetDate.slice(0, 4), 10);
    return Number.isFinite(year) && year <= nearHorizonCutoff.getFullYear();
  };
  const visible = showAll ? markets : markets.filter(m => isNear(m.targetDate));
  const hidden = markets.length - visible.length;

  const thStyle = { padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'left' as const };
  const thRight = { ...thStyle, textAlign: 'right' as const };
  const tdMono = { padding: '0.4rem 0.5rem', fontFamily: 'monospace', textAlign: 'right' as const };

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
            <th style={thStyle}>Metric</th>
            <th style={thStyle}>Horizon</th>
            <th style={thRight}>Baseline</th>
            <th style={thRight}>If approved</th>
            <th style={thRight}>Δ</th>
            <th style={thRight}>Trades</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(m => {
            const noSignal = m.tradeCount === 0;
            return (
              <tr key={m.marketId} style={{ borderBottom: '1px solid var(--border-color)', opacity: noSignal ? 0.65 : 1 }}>
                <td style={{ padding: '0.4rem 0.5rem', fontWeight: 500 }}>{m.metricName}</td>
                <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace' }}>
                  <div>{formatTargetDateDisplay(m.targetDate)}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{m.targetDate}</div>
                </td>
                <td style={tdMono}>{m.baselineConsensus != null ? formatNumber(m.baselineConsensus) : '—'}</td>
                <td style={tdMono}>{formatNumber(m.consensus)}</td>
                <td style={tdMono}><DeltaCell current={m.consensus} baseline={m.baselineConsensus} /></td>
                <td style={{ ...tdMono, color: noSignal ? 'var(--text-secondary)' : undefined, fontStyle: noSignal ? 'italic' : undefined }}>
                  {noSignal ? 'no signal' : m.tradeCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <button
          className="btn-small"
          onClick={() => setShowAll(v => !v)}
          style={{ marginTop: '0.5rem', background: 'transparent', color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}
        >
          {showAll ? 'Collapse long horizons' : `Show ${hidden} longer horizon${hidden === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}

function ChatPanel({ taskId }: { taskId: string }) {
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    setLoadError('');
    const data = await api.getTaskMessages(taskId).catch((e: Error) => { setLoadError(e.message); return null; });
    if (data) setMessages(data);
  }, [taskId]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const [sendError, setSendError] = useState('');

  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    setSendError('');
    const ok = await api.sendTaskMessage(taskId, input.trim()).catch((e: Error) => { setSendError(e.message); return null; });
    if (ok) setInput('');
    setSending(false);
    loadMessages();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{
        maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)', padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)',
        display: 'flex', flexDirection: 'column', gap: '0.4rem',
      }}>
        {messages.length === 0 && <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>No messages yet.</span>}
        {messages.map(msg => {
          const author = msg.from === 'admin'
            ? 'admin'
            : (msg.fromName ?? `${msg.from.slice(0, 6)}…`);
          return (
            <div key={msg.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
              <span
                title={msg.from}
                style={{
                  fontSize: '0.7rem', fontWeight: 600, color: msg.from === 'admin' ? 'var(--focus-border)' : '#8b5cf6',
                  minWidth: '70px', paddingTop: '0.05rem',
                }}
              >
                {author}
              </span>
              <span style={{ fontSize: '0.85rem', flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {(loadError || sendError) && <div style={{ color: 'var(--error-text)', fontSize: '0.8rem' }}>{loadError || sendError}</div>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message… (Enter to send)"
          rows={2}
          style={{
            flex: 1, resize: 'vertical', fontSize: '0.85rem',
          }}
        />
        <button className="btn-small" onClick={handleSend} disabled={sending || !input.trim()} style={{ alignSelf: 'flex-end', padding: '0.5rem 0.75rem' }}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

interface TaskDetailProps {
  task: TaskDetailData;
  isAdmin: boolean;
  onAction: () => void;
  onError: (msg: string) => void;
}

function TaskDetailPanel({ task, isAdmin, onAction, onError }: TaskDetailProps) {
  const { inspectTask, setInspectTask } = useInspectMode();
  const [acting, setActing] = useState(false);
  const isInspecting = inspectTask?.id === task.id;

  const handle = async (action: () => Promise<unknown>) => {
    setActing(true);
    await action().catch((e: Error) => onError(e.message));
    setActing(false);
    onAction();
  };

  const handleInspect = () => {
    setInspectTask(isInspecting ? null : { id: task.id, title: task.title });
  };

  return (
    <div style={{ padding: '0.75rem 0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {task.description && (
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{task.description}</p>
      )}

      {/* Actions */}
      {task.status === 'pending' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn-small"
              onClick={handleInspect}
              style={{ background: isInspecting ? '#7c3aed' : 'var(--focus-border)', color: '#fff', borderColor: isInspecting ? '#7c3aed' : 'var(--focus-border)', padding: '0.45rem 0.9rem' }}
            >
              {isInspecting ? 'Exit Inspect' : 'Inspect'}
            </button>
            {isAdmin && (
              <>
                <button
                  className="btn-small"
                  disabled={acting}
                  onClick={() => {
                    if (!window.confirm(`Approve "${task.title}"?\n\nThis will pay the proposer ${formatCurrency(task.price)} in credits and mark the task Done. Conditional markets stay open for post-decision tracking.`)) return;
                    handle(() => api.approveTask(task.id));
                  }}
                  style={{ background: '#22c55e', color: '#fff', borderColor: '#22c55e', padding: '0.45rem 0.9rem' }}
                >
                  {acting ? '…' : 'Approve'}
                </button>
                <button
                  className="btn-small"
                  disabled={acting}
                  onClick={() => {
                    if (!window.confirm(`Decline "${task.title}"?\n\nThis voids the task's conditional markets and refunds any stakes. The proposer is not paid.`)) return;
                    handle(() => api.declineTask(task.id));
                  }}
                  style={{ background: '#ef4444', color: '#fff', borderColor: '#ef4444', padding: '0.45rem 0.9rem' }}
                >
                  {acting ? '…' : 'Decline'}
                </button>
              </>
            )}
          </div>
          {isAdmin ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
              Approving pays the proposer {formatCurrency(task.price)} in credits. Declining voids conditional markets and refunds stakes.
            </p>
          ) : (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
              Only workspace admins can approve or decline. Click Inspect to see how this task would shift each metric.
            </p>
          )}
        </div>
      )}

      {/* Conditional markets */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Impact Predictions
        </div>
        <MarketSummaryTable markets={task.markets ?? []} />
      </div>

      {/* Chat */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Chat
        </div>
        <ChatPanel taskId={task.id} />
      </div>
    </div>
  );
}

export function TasksPage() {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const isAdmin = workspace?.tier === 'admin';
  const [tasks, setTasks] = useState<TaskProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedData, setExpandedData] = useState<Record<string, TaskDetailData>>({});

  // New task form
  const [form, setForm] = useState({ title: '', description: '', price: '' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    const data = await api.getTasks().catch((e: Error) => { setError(e.message); return null; });
    if (data) setTasks(data);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (user) {
      const detail = await api.getTask(id).catch((e: Error) => { setError(e.message); return null; });
      if (detail) setExpandedData(prev => ({ ...prev, [id]: detail }));
    }
  };

  const handleCreate = async () => {
    if (!user || !form.title || !form.price) return;
    setCreating(true);
    setError('');
    const result = await api.createTask({
      title: form.title,
      description: form.description,
      price: parseFloat(form.price),
    }).catch((e: Error) => { setError(e.message); return null; });
    setCreating(false);
    if (result) {
      setForm({ title: '', description: '', price: '' });
      load();
    }
  };

  const handleAction = async (taskId: string) => {
    await load();
    // Refresh expanded detail
    if (user) {
      const detail = await api.getTask(taskId).catch((e: Error) => { setError(e.message); return null; });
      if (detail) setExpandedData(prev => ({ ...prev, [taskId]: detail }));
    }
  };

  if (!user) return null;

  const inputStyle = { marginBottom: 0 } as const;
  const labelStyle = { display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' } as const;
  const thStyle = { padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'left' as const };

  return (
    <>
      <div className="container">
        <div className="section-header">
          <h2>Tasks</h2>
          <p className="section-subtitle">
            Admin-proposed initiatives, each paired with conditional markets so participants can forecast the impact before approval.
          </p>
        </div>
        {error && <div className="message error show">{error}</div>}

        {/* New task form (admins only; traders cannot propose tasks) */}
        {isAdmin && (
          <div className="section" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={labelStyle}>Title</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Improve sleep routine" style={{ ...inputStyle, width: '200px' }} />
            </div>
            <div>
              <label style={labelStyle}>Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional" style={{ ...inputStyle, width: '200px' }} />
            </div>
            <div>
              <label style={labelStyle}>Price ($)</label>
              <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                placeholder="500" min="1" style={{ ...inputStyle, width: '90px' }} />
            </div>
            <button className="btn" onClick={handleCreate} disabled={creating || !form.title || !form.price}>
              {creating ? 'Proposing…' : 'Propose Task'}
            </button>
          </div>
        )}
        {workspace && !isAdmin && (
          <div className="section" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            You have trader access in this workspace. You can see proposed tasks and forecast on conditional markets,
            but only admins can propose or approve tasks.
          </div>
        )}

        {loading ? (
          <div className="loading">Loading tasks…</div>
        ) : tasks.length === 0 ? (
          <div className="section"><p style={{ color: 'var(--text-secondary)' }}>No tasks yet.</p></div>
        ) : (
          <div className="section">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Proposed by</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Price ($)</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <React.Fragment key={task.id}>
                    <tr
                      style={{ borderBottom: expandedId === task.id ? 'none' : '1px solid var(--border-color)', cursor: 'pointer' }}
                      onClick={() => handleExpand(task.id)}
                    >
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>{task.title}</td>
                      <td
                        style={{ padding: '0.75rem 0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}
                        title={task.proposedBy}
                      >
                        {task.proposedByName ?? (
                          <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{`${task.proposedBy.slice(0, 8)}…`}</span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{formatCurrency(task.price)}</td>
                      <td style={{ padding: '0.75rem 0.5rem' }}><StatusBadge status={task.status} /></td>
                    </tr>
                    {expandedId === task.id && (
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={4} style={{ padding: '0 0.5rem 0.75rem' }}>
                          <TaskDetailPanel
                            task={expandedData[task.id] ?? task}
                            isAdmin={isAdmin}
                            onAction={() => handleAction(task.id)}
                            onError={setError}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
