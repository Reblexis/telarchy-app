import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useInspectMode } from '../hooks/useInspectMode';
import { useTaskUtilitySummary } from '../hooks/useTaskUtilitySummary';
import { api } from '../lib/api';
import { formatTargetDateDisplay } from '../lib/date-utils';
import type { TaskProposal, TaskMessage, TaskMarketSummary, TaskDetailData, TaskUtilitySummary } from '../types';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#22c55e',
  declined: '#ef4444',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.5rem',
      borderRadius: '0.25rem', background: `${STATUS_COLORS[status] ?? '#888'}22`,
      color: STATUS_COLORS[status] ?? '#888', textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {status}
    </span>
  );
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.005 ? String(rounded) : value.toFixed(2);
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function DeltaBadge({ current, baseline }: { current: number | null | undefined; baseline: number | null | undefined }) {
  if (current == null || baseline == null) return null;
  const delta = current - baseline;
  if (Math.abs(delta) < 0.005) return null;
  return (
    <span style={{ fontSize: '0.72rem', color: delta > 0 ? '#22c55e' : '#ef4444', fontFamily: 'monospace' }}>
      {delta > 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(2)}
      <span style={{ color: 'var(--text-secondary)', marginLeft: '0.2rem' }}>({formatNumber(baseline)})</span>
    </span>
  );
}

function UtilitySummaryCard({ summary, loading }: { summary?: TaskUtilitySummary; loading: boolean }) {
  const expectedUtility = summary?.expectedCurrentUtility ?? null;
  const baselineUtility = summary?.baselineUtility ?? null;

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: '0.5rem',
      padding: '0.75rem',
      background: 'var(--bg-secondary, #f8f9fa)',
    }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Expected Current Utility
      </div>
      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Loading...
        </div>
      ) : expectedUtility === null ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Unavailable until conditional markets exist for this task.
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 600 }}>{formatNumber(expectedUtility)}</span>
          <DeltaBadge current={expectedUtility} baseline={baselineUtility} />
        </div>
      )}
    </div>
  );
}

function MarketSummaryTable({ markets }: { markets: TaskMarketSummary[] }) {
  if (markets.length === 0) return <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>No conditional markets yet. Click &quot;Inspect&quot; to view them in Markets.</p>;
  const thStyle = { padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'left' as const };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
          <th style={thStyle}>Metric</th>
          <th style={thStyle}>Resolution Date</th>
          <th style={thStyle}>Consensus</th>
          <th style={thStyle}>Liquidity</th>
          <th style={thStyle}>Trades</th>
          <th style={thStyle}>Range</th>
        </tr>
      </thead>
      <tbody>
        {markets.map(m => (
          <tr key={m.marketId} style={{ borderBottom: '1px solid var(--border-color)' }}>
            <td style={{ padding: '0.4rem 0.5rem', fontWeight: 500 }}>{m.metricName}</td>
            <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace' }}>
              <div>{formatTargetDateDisplay(m.targetDate)}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{m.targetDate}</div>
            </td>
            <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <span>{formatNumber(m.consensus)}</span>
                <DeltaBadge current={m.consensus} baseline={m.baselineConsensus} />
              </div>
            </td>
            <td style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{formatNumber(m.liquidity)}</td>
            <td style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>{m.tradeCount}</td>
            <td style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.75rem' }}>
              {formatNumber(m.rangeMin)}–{formatNumber(m.rangeMax)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
        borderRadius: '0.375rem', padding: '0.5rem', background: 'var(--bg-secondary, #f8f9fa)',
        display: 'flex', flexDirection: 'column', gap: '0.4rem',
      }}>
        {messages.length === 0 && <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>No messages yet.</span>}
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
            <span style={{
              fontSize: '0.7rem', fontWeight: 600, color: msg.from === 'admin' ? 'var(--accent-color, #3b82f6)' : '#a855f7',
              minWidth: '70px', paddingTop: '0.05rem',
            }}>
              {msg.from === 'admin' ? 'admin' : msg.from}
            </span>
            <span style={{ fontSize: '0.85rem', flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {(loadError || sendError) && <div style={{ color: '#ef4444', fontSize: '0.8rem' }}>{loadError || sendError}</div>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message… (Enter to send)"
          rows={2}
          style={{
            flex: 1, padding: '0.4rem', borderRadius: '0.375rem',
            border: '1px solid var(--border-color)', background: 'var(--bg-color)',
            color: 'var(--text-color)', resize: 'vertical', fontSize: '0.85rem',
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
  onAction: () => void;
  onError: (msg: string) => void;
}

function TaskDetailPanel({ task, onAction, onError }: TaskDetailProps) {
  const { inspectTask, setInspectTask } = useInspectMode();
  const [acting, setActing] = useState(false);
  const { summary: utilitySummary, loading: utilitySummaryLoading } = useTaskUtilitySummary(true, task.id);

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
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn-small"
            onClick={handleInspect}
            style={{ background: isInspecting ? '#7c3aed' : 'var(--accent-color, #3b82f6)', color: '#fff', padding: '0.45rem 0.9rem' }}
          >
            {isInspecting ? 'Exit Inspect' : 'Inspect'}
          </button>
          <button
            className="btn-small"
            disabled={acting}
            onClick={() => handle(() => api.approveTask(task.id))}
            style={{ background: '#22c55e', color: '#fff', padding: '0.45rem 0.9rem' }}
          >
            {acting ? '…' : 'Approve'}
          </button>
          <button
            className="btn-small"
            disabled={acting}
            onClick={() => handle(() => api.declineTask(task.id))}
            style={{ background: '#ef4444', color: '#fff', padding: '0.45rem 0.9rem' }}
          >
            {acting ? '…' : 'Decline'}
          </button>
        </div>
      )}

      {/* Conditional markets */}
      <UtilitySummaryCard summary={utilitySummary} loading={utilitySummaryLoading} />

      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Conditional Markets
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

  const inputStyle = { padding: '0.4rem 0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' } as const;
  const labelStyle = { display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' } as const;
  const thStyle = { padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'left' as const };

  return (
    <>
      <div className="container">
        {error && <div className="message error show">{error}</div>}

        {/* New task form */}
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
                  <th style={thStyle}>Participant</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Price ($)</th>
                  <th style={thStyle}>Markets</th>
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
                      <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{task.proposedBy}</td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{formatCurrency(task.price)}</td>
                      <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {task.conditionalMarketIds?.length > 0 ? task.conditionalMarketIds.length : '—'}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}><StatusBadge status={task.status} /></td>
                    </tr>
                    {expandedId === task.id && (
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={5} style={{ padding: '0 0.5rem 0.75rem' }}>
                          <TaskDetailPanel
                            task={expandedData[task.id] ?? task}
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
