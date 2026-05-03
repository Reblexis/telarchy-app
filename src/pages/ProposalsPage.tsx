import React, { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { useInspectMode } from '../hooks/useInspectMode';
import { api } from '../lib/api';
import { formatTargetDateDisplay } from '../lib/date-utils';
import type { Proposal, ProposalMessage, ProposalMarketSummary, ProposalDetailData, ProposalStatus } from '../types';

function StatusBadge({ status }: { status: ProposalStatus }) {
  return <span className={`status-badge proposal-status proposal-status--${status}`}>{status}</span>;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.005 ? String(rounded) : value.toFixed(2);
}

/**
 * One-line summary of how the proposal's conditional markets are pricing the
 * proposal, used in the approve-confirm. Picks up to two largest-magnitude
 * forecast moves (signed % from baseline) so the approver re-sees the
 * signal at the commit moment instead of clicking blind.
 */
function summarizeMarketsForConfirm(markets: ProposalMarketSummary[] | undefined): string {
  if (!markets || markets.length === 0) return '';
  const moves = markets
    .filter(m => m.tradeCount > 0 && m.consensus != null && m.baselineConsensus != null && (m.baselineConsensus as number) !== 0)
    .map(m => {
      const base = m.baselineConsensus as number;
      const cur = m.consensus as number;
      const pct = ((cur - base) / Math.abs(base)) * 100;
      return { name: m.metricName, pct, cur, base };
    })
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  if (moves.length === 0) return '';
  const top = moves.slice(0, 2)
    .map(m => `${m.name}: ${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(1)}% (${formatNumber(m.base)} → ${formatNumber(m.cur)})`)
    .join('; ');
  const more = moves.length > 2 ? ` (+${moves.length - 2} more)` : '';
  return `${top}${more}`;
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

function PredictionsTable({ markets }: { markets: ProposalMarketSummary[] }) {
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

function ChatPanel({ proposalId }: { proposalId: string }) {
  const [messages, setMessages] = useState<ProposalMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const initialScroll = useRef(true);

  const loadMessages = useCallback(async () => {
    setLoadError('');
    const data = await api.getProposalMessages(proposalId).catch((e: Error) => { setLoadError(e.message); return null; });
    if (data) setMessages(data);
  }, [proposalId]);

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
    const ok = await api.sendProposalMessage(proposalId, input.trim()).catch((e: Error) => { setSendError(e.message); return null; });
    if (ok) setInput('');
    setSending(false);
    loadMessages();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="proposal-chat">
      <div className="proposal-chat-messages" ref={containerRef}>
        {messages.length === 0 && <span className="proposal-chat-empty">No messages yet.</span>}
        {messages.map(msg => {
          const isAdmin = msg.from === 'admin';
          const author = isAdmin ? 'admin' : (msg.fromName ?? `${msg.from.slice(0, 6)}…`);
          return (
            <div key={msg.id} className="proposal-chat-msg">
              <span
                title={msg.from}
                className={`proposal-chat-author ${isAdmin ? 'proposal-chat-author--admin' : 'proposal-chat-author--participant'}`}
              >
                {author}
              </span>
              <span className="proposal-chat-content">{msg.content}</span>
            </div>
          );
        })}
      </div>
      {(loadError || sendError) && <div className="proposal-chat-error">{loadError || sendError}</div>}
      <div className="proposal-chat-input">
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

interface ProposalDrawerProps {
  proposal: ProposalDetailData | null;
  isAdmin: boolean;
  onClose: () => void;
  onAction: () => void;
  onError: (msg: string) => void;
}

function ProposalDrawer({ proposal, isAdmin, onClose, onAction, onError }: ProposalDrawerProps) {
  const { inspectProposal, setInspectProposal } = useInspectMode();
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (!proposal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [proposal, onClose]);

  useEffect(() => {
    if (!proposal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [proposal]);

  if (!proposal) return null;
  const isInspecting = inspectProposal?.id === proposal.id;

  const handle = async (action: () => Promise<unknown>) => {
    setActing(true);
    await action().catch((e: Error) => onError(e.message));
    setActing(false);
    onAction();
  };

  const handleInspect = () => {
    setInspectProposal(isInspecting ? null : { id: proposal.id, title: proposal.title });
  };

  return (
    <>
      <div className="proposal-drawer-scrim show" onClick={onClose} aria-hidden="true" />
      <aside className="proposal-drawer open" role="dialog" aria-label={`Proposal: ${proposal.title}`}>
        <header className="proposal-drawer-header">
          <div className="proposal-drawer-title">
            <h3>{proposal.title}</h3>
            <div className="proposal-drawer-meta">
              <StatusBadge status={proposal.status} />
              <span className="proposal-drawer-proposer">
                proposed by {proposal.proposedByName ?? `${proposal.proposedBy.slice(0, 8)}…`}
              </span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close proposal panel">&times;</button>
        </header>

        <div className="proposal-drawer-body">
          {proposal.description && <p className="proposal-description">{proposal.description}</p>}

          {proposal.status === 'pending' && (
            <div className="proposal-actions-row">
              <div className="proposal-actions">
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
                        const forecast = summarizeMarketsForConfirm(proposal.markets);
                        const lines = [
                          `Approve "${proposal.title}"?`,
                          '',
                          forecast ? `Forecast: ${forecast}` : 'Forecast: no market signal yet.',
                          '',
                          'Conditional markets stay open for post-decision tracking.',
                        ];
                        if (!window.confirm(lines.join('\n'))) return;
                        handle(() => api.approveProposal(proposal.id));
                      }}
                    >
                      {acting ? '…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="btn-decline"
                      disabled={acting}
                      onClick={() => {
                        if (!window.confirm(`Decline "${proposal.title}"?\n\nThis voids the proposal's conditional markets and refunds any stakes.`)) return;
                        handle(() => api.declineProposal(proposal.id));
                      }}
                    >
                      {acting ? '…' : 'Decline'}
                    </button>
                  </>
                )}
              </div>
              <p className="proposal-actions-hint">
                {isAdmin
                  ? 'Declining voids conditional markets and refunds stakes.'
                  : 'Only workspace admins can approve or decline. Click Inspect to see how this proposal would shift each metric.'}
              </p>
            </div>
          )}

          <section className="proposal-drawer-section">
            <h4>Impact predictions</h4>
            <PredictionsTable markets={proposal.markets ?? []} />
          </section>

          <section className="proposal-drawer-section">
            <h4>Discussion</h4>
            <ChatPanel proposalId={proposal.id} />
          </section>
        </div>
      </aside>
    </>
  );
}

interface NewProposalModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}

function NewProposalModal({ open, onClose, onCreated, onError }: NewProposalModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(''); setDescription(''); setCreating(false);
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title) return;
    setCreating(true);
    const result = await api.createProposal({
      title,
      description,
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
          <h3>Propose proposal</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="newProposalTitle">Title</label>
            <input
              id="newProposalTitle" type="text" required
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Improve sleep routine"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="newProposalDescription">Description</label>
            <textarea
              id="newProposalDescription"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What would change if this is done? (optional)"
              rows={3}
            />
          </div>
          <button type="submit" className="btn" disabled={creating || !title}>
            {creating ? 'Proposing…' : 'Propose proposal'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function ProposalsPage() {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const isAdmin = workspace?.tier === 'admin';
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openProposalId, setOpenProposalId] = useState<string | null>(null);
  const [openProposalData, setOpenProposalData] = useState<ProposalDetailData | null>(null);
  const [newProposalOpen, setNewProposalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    const data = await api.getProposals().catch((e: Error) => { setError(e.message); return null; });
    if (data) setProposals(data);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    const detail = await api.getProposal(id).catch((e: Error) => { setError(e.message); return null; });
    if (detail) setOpenProposalData(detail);
  }, []);

  const openProposal = (proposal: Proposal) => {
    setOpenProposalId(proposal.id);
    setOpenProposalData(proposal as ProposalDetailData);
    loadDetail(proposal.id);
  };

  const closeProposal = () => {
    setOpenProposalId(null);
    setOpenProposalData(null);
  };

  const handleAction = async () => {
    await load();
    if (openProposalId) await loadDetail(openProposalId);
  };

  if (!user) return null;

  return (
    <div className="container">
      <div className="section-header section-header--with-status">
        <div>
          <h2>Proposals</h2>
          <p className="section-subtitle">
            Admin-proposed initiatives, each paired with conditional markets so participants can forecast the impact before approval.
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn" onClick={() => setNewProposalOpen(true)}>
            + Propose proposal
          </button>
        )}
      </div>

      {error && <div className="message error show">{error}</div>}

      {workspace && !isAdmin && (
        <p className="proposal-trader-hint">
          You have trader access in this workspace. You can see proposed proposals and forecast on conditional markets,
          but only admins can propose or approve proposals.
        </p>
      )}

      {loading ? (
        <div className="loading">Loading proposals…</div>
      ) : proposals.length === 0 ? (
        <div className="proposal-empty">
          <p>No proposals yet.</p>
          {isAdmin && (
            <button type="button" className="btn" onClick={() => setNewProposalOpen(true)}>
              Propose the first proposal
            </button>
          )}
        </div>
      ) : (
        <div className="proposal-list">
          <table className="proposal-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Proposed by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map(proposal => (
                <tr
                  key={proposal.id}
                  className={`proposal-row${openProposalId === proposal.id ? ' proposal-row--active' : ''}`}
                  onClick={() => openProposal(proposal)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open proposal ${proposal.title}`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProposal(proposal); } }}
                >
                  <td className="proposal-row-title">{proposal.title}</td>
                  <td className="proposal-row-proposer" title={proposal.proposedBy}>
                    {proposal.proposedByName ?? (
                      <span className="proposal-row-proposer-id">{`${proposal.proposedBy.slice(0, 8)}…`}</span>
                    )}
                  </td>
                  <td><StatusBadge status={proposal.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProposalDrawer
        proposal={openProposalId ? openProposalData : null}
        isAdmin={isAdmin}
        onClose={closeProposal}
        onAction={handleAction}
        onError={setError}
      />

      <NewProposalModal
        open={newProposalOpen}
        onClose={() => setNewProposalOpen(false)}
        onCreated={load}
        onError={setError}
      />
    </div>
  );
}
