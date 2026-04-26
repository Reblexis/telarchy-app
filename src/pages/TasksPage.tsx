import React, { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { useInspectMode } from '../hooks/useInspectMode';
import { api } from '../lib/api';
import { formatTargetDateDisplay } from '../lib/date-utils';
import type { TaskProposal, TaskMessage, TaskMarketSummary, TaskDetailData, TaskStatus } from '../types';

function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`status-badge task-status task-status--${status}`}>{status}</span>;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.005 ? String(rounded) : value.toFixed(2);
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function ForecastCell({ baseline, current }: { baseline: number | null | undefined; current: number | null }) {
  if (current == null) return <span className="forecast-empty">—</span>;
  if (baseline == null) {
    return <span className="forecast-cell"><span className="forecast-after">{formatNumber(current)}</span></span>;
  }
  const delta = current - baseline;
  const deltaClass = Math.abs(delta) < 0.005
    ? 'forecast-delta--flat'
    : delta > 0 ? 'forecast-delta--up' : 'forecast-delta--down';
  const deltaLabel = Math.abs(delta) < 0.005
    ? '±0'
    : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 2 : 1)}`;
  return (
    <span className="forecast-cell">
      <span className="forecast-before">{formatNumber(baseline)}</span>
      <span className="forecast-arrow">→</span>
      <span className="forecast-after">{formatNumber(current)}</span>
      <span className={`forecast-delta ${deltaClass}`}>{deltaLabel}</span>
    </span>
  );
}

function PredictionsTable({ markets }: { markets: TaskMarketSummary[] }) {
  const [showAll, setShowAll] = useState(false);

  if (markets.length === 0) {
    return <p className="predictions-empty">No impact predictions yet. Click <strong>Inspect</strong> to spawn conditional markets.</p>;
  }

  const nearHorizonCutoff = new Date();
  nearHorizonCutoff.setFullYear(nearHorizonCutoff.getFullYear() + 1);
  const isNear = (targetDate: string) => {
    const year = parseInt(targetDate.slice(0, 4), 10);
    return Number.isFinite(year) && year <= nearHorizonCutoff.getFullYear();
  };
  const visible = showAll ? markets : markets.filter(m => isNear(m.targetDate));
  const hidden = markets.length - visible.length;

  return (
    <div className="predictions-wrap">
      <table className="predictions-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Horizon</th>
            <th className="num">Forecast</th>
            <th className="num">Trades</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(m => {
            const noSignal = m.tradeCount === 0;
            return (
              <tr key={m.marketId} className={noSignal ? 'no-signal' : ''}>
                <td className="metric-name">{m.metricName}</td>
                <td className="horizon">{formatTargetDateDisplay(m.targetDate)}</td>
                <td className="num"><ForecastCell baseline={m.baselineConsensus} current={m.consensus} /></td>
                <td className="num">{noSignal ? <span className="no-signal-label">no signal</span> : m.tradeCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <button type="button" className="link-button" onClick={() => setShowAll(v => !v)}>
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
  const [sendError, setSendError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const initialScroll = useRef(true);

  const loadMessages = useCallback(async () => {
    setLoadError('');
    const data = await api.getTaskMessages(taskId).catch((e: Error) => { setLoadError(e.message); return null; });
    if (data) setMessages(data);
  }, [taskId]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (initialScroll.current) {
      el.scrollTop = el.scrollHeight;
      initialScroll.current = false;
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
    <div className="task-chat">
      <div className="task-chat-messages" ref={containerRef}>
        {messages.length === 0 && <span className="task-chat-empty">No messages yet.</span>}
        {messages.map(msg => {
          const isAdmin = msg.from === 'admin';
          const author = isAdmin ? 'admin' : (msg.fromName ?? `${msg.from.slice(0, 6)}…`);
          return (
            <div key={msg.id} className="task-chat-msg">
              <span
                title={msg.from}
                className={`task-chat-author ${isAdmin ? 'task-chat-author--admin' : 'task-chat-author--participant'}`}
              >
                {author}
              </span>
              <span className="task-chat-content">{msg.content}</span>
            </div>
          );
        })}
      </div>
      {(loadError || sendError) && <div className="task-chat-error">{loadError || sendError}</div>}
      <div className="task-chat-input">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message… (Enter to send)"
          rows={2}
        />
        <button className="btn-small" onClick={handleSend} disabled={sending || !input.trim()}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

interface TaskDrawerProps {
  task: TaskDetailData | null;
  isAdmin: boolean;
  onClose: () => void;
  onAction: () => void;
  onError: (msg: string) => void;
}

function TaskDrawer({ task, isAdmin, onClose, onAction, onError }: TaskDrawerProps) {
  const { inspectTask, setInspectTask } = useInspectMode();
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (!task) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [task, onClose]);

  useEffect(() => {
    if (!task) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [task]);

  if (!task) return null;
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
    <>
      <div className="task-drawer-scrim show" onClick={onClose} aria-hidden="true" />
      <aside className="task-drawer open" role="dialog" aria-label={`Task: ${task.title}`}>
        <header className="task-drawer-header">
          <div className="task-drawer-title">
            <h3>{task.title}</h3>
            <div className="task-drawer-meta">
              <StatusBadge status={task.status} />
              <span className="task-drawer-price">{formatCurrency(task.price)}</span>
              <span className="task-drawer-proposer">
                proposed by {task.proposedByName ?? `${task.proposedBy.slice(0, 8)}…`}
              </span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close task panel">&times;</button>
        </header>

        <div className="task-drawer-body">
          {task.description && <p className="task-description">{task.description}</p>}

          {task.status === 'pending' && (
            <div className="task-actions-row">
              <div className="task-actions">
                <button
                  type="button"
                  className={`btn-inspect${isInspecting ? ' btn-inspect--active' : ''}`}
                  onClick={handleInspect}
                >
                  {isInspecting ? 'Exit Inspect' : 'Inspect'}
                </button>
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      className="btn-approve"
                      disabled={acting}
                      onClick={() => {
                        if (!window.confirm(`Approve "${task.title}"?\n\nThis will pay the proposer ${formatCurrency(task.price)} in credits and mark the task Done. Conditional markets stay open for post-decision tracking.`)) return;
                        handle(() => api.approveTask(task.id));
                      }}
                    >
                      {acting ? '…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="btn-decline"
                      disabled={acting}
                      onClick={() => {
                        if (!window.confirm(`Decline "${task.title}"?\n\nThis voids the task's conditional markets and refunds any stakes. The proposer is not paid.`)) return;
                        handle(() => api.declineTask(task.id));
                      }}
                    >
                      {acting ? '…' : 'Decline'}
                    </button>
                  </>
                )}
              </div>
              <p className="task-actions-hint">
                {isAdmin
                  ? `Approving pays the proposer ${formatCurrency(task.price)} in credits. Declining voids conditional markets and refunds stakes.`
                  : 'Only workspace admins can approve or decline. Click Inspect to see how this task would shift each metric.'}
              </p>
            </div>
          )}

          <section className="task-drawer-section">
            <h4>Impact predictions</h4>
            <PredictionsTable markets={task.markets ?? []} />
          </section>

          <section className="task-drawer-section">
            <h4>Discussion</h4>
            <ChatPanel taskId={task.id} />
          </section>
        </div>
      </aside>
    </>
  );
}

interface NewTaskModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}

function NewTaskModal({ open, onClose, onCreated, onError }: NewTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(''); setDescription(''); setPrice(''); setCreating(false);
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title || !price) return;
    setCreating(true);
    const result = await api.createTask({
      title,
      description,
      price: parseFloat(price),
    }).catch((e: Error) => { onError(e.message); return null; });
    setCreating(false);
    if (result) { onCreated(); onClose(); }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal show" onClick={handleOverlayClick}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>Propose task</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="newTaskTitle">Title</label>
            <input
              id="newTaskTitle" type="text" required
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Improve sleep routine"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="newTaskDescription">Description</label>
            <textarea
              id="newTaskDescription"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What would change if this is done? (optional)"
              rows={3}
            />
          </div>
          <div className="form-group">
            <label htmlFor="newTaskPrice">Price (credits)</label>
            <input
              id="newTaskPrice" type="number" required min="1"
              value={price} onChange={e => setPrice(e.target.value)}
              placeholder="500"
            />
          </div>
          <button type="submit" className="btn" disabled={creating || !title || !price}>
            {creating ? 'Proposing…' : 'Propose task'}
          </button>
        </form>
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
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openTaskData, setOpenTaskData] = useState<TaskDetailData | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    const data = await api.getTasks().catch((e: Error) => { setError(e.message); return null; });
    if (data) setTasks(data);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    const detail = await api.getTask(id).catch((e: Error) => { setError(e.message); return null; });
    if (detail) setOpenTaskData(detail);
  }, []);

  const openTask = (task: TaskProposal) => {
    setOpenTaskId(task.id);
    setOpenTaskData(task as TaskDetailData);
    loadDetail(task.id);
  };

  const closeTask = () => {
    setOpenTaskId(null);
    setOpenTaskData(null);
  };

  const handleAction = async () => {
    await load();
    if (openTaskId) await loadDetail(openTaskId);
  };

  if (!user) return null;

  return (
    <div className="container">
      <div className="section-header section-header--with-status">
        <div>
          <h2>Tasks</h2>
          <p className="section-subtitle">
            Admin-proposed initiatives, each paired with conditional markets so participants can forecast the impact before approval.
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn" onClick={() => setNewTaskOpen(true)}>
            + Propose task
          </button>
        )}
      </div>

      {error && <div className="message error show">{error}</div>}

      {workspace && !isAdmin && (
        <p className="task-trader-hint">
          You have trader access in this workspace. You can see proposed tasks and forecast on conditional markets,
          but only admins can propose or approve tasks.
        </p>
      )}

      {loading ? (
        <div className="loading">Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <div className="task-empty">
          <p>No tasks yet.</p>
          {isAdmin && (
            <button type="button" className="btn" onClick={() => setNewTaskOpen(true)}>
              Propose the first task
            </button>
          )}
        </div>
      ) : (
        <div className="task-list">
          <table className="task-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Proposed by</th>
                <th className="num">Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => (
                <tr
                  key={task.id}
                  className={`task-row${openTaskId === task.id ? ' task-row--active' : ''}`}
                  onClick={() => openTask(task)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open task ${task.title}`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTask(task); } }}
                >
                  <td className="task-row-title">{task.title}</td>
                  <td className="task-row-proposer" title={task.proposedBy}>
                    {task.proposedByName ?? (
                      <span className="task-row-proposer-id">{`${task.proposedBy.slice(0, 8)}…`}</span>
                    )}
                  </td>
                  <td className="num task-row-price">{formatCurrency(task.price)}</td>
                  <td><StatusBadge status={task.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TaskDrawer
        task={openTaskId ? openTaskData : null}
        isAdmin={isAdmin}
        onClose={closeTask}
        onAction={handleAction}
        onError={setError}
      />

      <NewTaskModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onCreated={load}
        onError={setError}
      />
    </div>
  );
}
