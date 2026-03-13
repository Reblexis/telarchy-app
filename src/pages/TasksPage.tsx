import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { api } from '../lib/api';
import type { TaskProposal, TaskMessage, TaskMarketSummary } from '../types';

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

function MarketSummaryTable({ markets }: { markets: TaskMarketSummary[] }) {
  if (markets.length === 0) return <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>No conditional markets yet. Click &quot;Test&quot; to create them.</p>;
  const thStyle = { padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'left' as const };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
          <th style={thStyle}>Metric</th>
          <th style={thStyle}>Consensus</th>
          <th style={thStyle}>Probability</th>
          <th style={thStyle}>Trades</th>
          <th style={thStyle}>Range</th>
        </tr>
      </thead>
      <tbody>
        {markets.map(m => (
          <tr key={m.marketId} style={{ borderBottom: '1px solid var(--border-color)' }}>
            <td style={{ padding: '0.4rem 0.5rem', fontWeight: 500 }}>{m.metricName}</td>
            <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace' }}>{m.consensus ?? '—'}</td>
            <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{ width: '60px', height: '6px', background: 'var(--border-color)', borderRadius: '3px', position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${m.probability * 100}%`, background: 'var(--accent-color, #3b82f6)', borderRadius: '3px' }} />
                </div>
                <span>{Math.round(m.probability * 100)}%</span>
              </div>
            </td>
            <td style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>{m.tradeCount}</td>
            <td style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.75rem' }}>
              {m.rangeMin}–{m.rangeMax}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChatPanel({ taskId, user }: { taskId: string; user: import('firebase/auth').User }) {
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    const data = await api.getTaskMessages(user, taskId).catch(() => null);
    if (data) setMessages(data);
  }, [user, taskId]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    await api.sendTaskMessage(user, taskId, input.trim()).catch(() => {});
    setInput('');
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
  task: TaskProposal & { markets?: TaskMarketSummary[] };
  user: import('firebase/auth').User;
  onAction: () => void;
  onError: (msg: string) => void;
}

function TaskDetail({ task, user, onAction, onError }: TaskDetailProps) {
  const [markets, setMarkets] = useState<TaskMarketSummary[]>(task.markets || []);
  const [acting, setActing] = useState(false);
  const [testResult, setTestResult] = useState('');

  const handle = async (action: () => Promise<unknown>) => {
    setActing(true);
    await action().catch((e: Error) => onError(e.message));
    setActing(false);
    onAction();
  };

  const handleTest = async () => {
    setActing(true);
    setTestResult('');
    const result = await api.testTask(user, task.id).catch((e: Error) => { onError(e.message); return null; });
    if (result) {
      setTestResult(`${result.created} markets created.`);
      const detail = await api.getTask(user, task.id).catch(() => null);
      if (detail?.markets) setMarkets(detail.markets);
    }
    setActing(false);
    onAction();
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
            disabled={acting}
            onClick={handleTest}
            style={{ background: 'var(--accent-color, #3b82f6)', color: '#fff', padding: '0.45rem 0.9rem' }}
          >
            {acting ? '…' : 'Test'}
          </button>
          <button
            className="btn-small"
            disabled={acting}
            onClick={() => handle(() => api.approveTask(user, task.id))}
            style={{ background: '#22c55e', color: '#fff', padding: '0.45rem 0.9rem' }}
          >
            {acting ? '…' : 'Approve'}
          </button>
          <button
            className="btn-small"
            disabled={acting}
            onClick={() => handle(() => api.declineTask(user, task.id))}
            style={{ background: '#ef4444', color: '#fff', padding: '0.45rem 0.9rem' }}
          >
            {acting ? '…' : 'Decline'}
          </button>
          {testResult && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{testResult}</span>}
        </div>
      )}

      {/* Conditional markets */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Conditional Markets
        </div>
        <MarketSummaryTable markets={markets} />
      </div>

      {/* Chat */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Chat
        </div>
        <ChatPanel taskId={task.id} user={user} />
      </div>
    </div>
  );
}

export function TasksPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  useDarkMode();
  const [tasks, setTasks] = useState<TaskProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedData, setExpandedData] = useState<Record<string, TaskProposal & { markets?: TaskMarketSummary[] }>>({});

  // New task form
  const [form, setForm] = useState({ title: '', description: '', price: '' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    const data = await api.getTasks(user).catch((e: Error) => { setError(e.message); return null; });
    if (data) setTasks(data);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!expandedData[id] && user) {
      const detail = await api.getTask(user, id).catch(() => null);
      if (detail) setExpandedData(prev => ({ ...prev, [id]: detail }));
    }
  };

  const handleCreate = async () => {
    if (!user || !form.title || !form.price) return;
    setCreating(true);
    setError('');
    const result = await api.createTask(user, {
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
      const detail = await api.getTask(user, taskId).catch(() => null);
      if (detail) setExpandedData(prev => ({ ...prev, [taskId]: detail }));
    }
  };

  if (authLoading) return <div className="loading">Loading...</div>;
  if (!user) { navigate('/', { replace: true }); return null; }

  const inputStyle = { padding: '0.4rem 0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' } as const;
  const labelStyle = { display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' } as const;
  const thStyle = { padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'left' as const };

  return (
    <>
      <div className="header">
        <img src="/logo.png" alt="Telarchy" style={{ height: '5.25rem' }} />
        <nav className="header-nav">
          <Link to="/metrics" className="nav-link">Metrics</Link>
          <Link to="/agents" className="nav-link">Agents</Link>
          <Link to="/markets" className="nav-link">Markets</Link>
          <Link to="/tasks" className="nav-link active">Tasks</Link>
        </nav>
        <div className="header-actions" />
      </div>
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
            <label style={labelStyle}>Price (credits)</label>
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
                  <th style={thStyle}>Agent</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
                  <th style={thStyle}>Markets</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <>
                    <tr
                      key={task.id}
                      style={{ borderBottom: expandedId === task.id ? 'none' : '1px solid var(--border-color)', cursor: 'pointer' }}
                      onClick={() => handleExpand(task.id)}
                    >
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>{task.title}</td>
                      <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{task.proposedBy}</td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{task.price}</td>
                      <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {task.conditionalMarketIds.length > 0 ? task.conditionalMarketIds.length : '—'}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}><StatusBadge status={task.status} /></td>
                    </tr>
                    {expandedId === task.id && (
                      <tr key={`${task.id}-detail`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={5} style={{ padding: '0 0.5rem 0.75rem' }}>
                          <TaskDetail
                            task={expandedData[task.id] ?? task}
                            user={user}
                            onAction={() => handleAction(task.id)}
                            onError={setError}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
