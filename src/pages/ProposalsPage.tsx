import React, { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { useInspectMode } from '../hooks/useInspectMode';
import { api } from '../lib/api';
import { formatTargetDateDisplay } from '../lib/date-utils';
import { linkify } from '../lib/linkify';
import { isCompositeMetric, getLeafDescendantIds } from '../lib/metric-tree';
import type { Proposal, ProposalMessage, ProposalMarketSummary, ProposalDetailData, ProposalStatus, Metric } from '../types';
import { FirstSeenHint } from '../components/FirstSeenHint';

function StatusBadge({ status }: { status: ProposalStatus }) {
  return <span className={`status-badge proposal-status proposal-status--${status}`}>{status}</span>;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.005 ? String(rounded) : value.toFixed(2);
}

/**
 * Same near-horizon filter PredictionsTable applies by default. Long
 * horizons get hidden from the table because their markets are sparsely
 * traded and read as noise; the same noise must be hidden from the
 * confirm dialog or the top-2 line shows a 2030 market with one stray
 * trade while the visible table looks calibrated. Cutoff is currentYear
 * + 1 to mirror the table.
 */
function isNearHorizon(targetDate: string): boolean {
  const year = parseInt(targetDate.slice(0, 4), 10);
  if (!Number.isFinite(year)) return true;
  return year <= new Date().getFullYear() + 1;
}

/**
 * One-line summary of how the proposal's conditional markets are pricing the
 * proposal, used in the approve-confirm. Picks up to two largest-magnitude
 * forecast moves (signed % between approved and declined branches) so the
 * approver re-sees the causal-delta signal at the commit moment.
 *
 * Restricted to near-horizon markets so the line agrees with what the
 * approver actually sees in the predictions table; otherwise a thinly
 * traded long-horizon market with a stray outlier wins the top spot and
 * tells a different story than the table.
 */
function summarizeMarketsForConfirm(markets: ProposalMarketSummary[] | undefined): string {
  if (!markets || markets.length === 0) return '';
  const moves = markets
    .filter(m => {
      if (!isNearHorizon(m.targetDate)) return false;
      const a = m.approved?.consensus ?? null;
      const d = m.declined?.consensus ?? null;
      const traded = (m.approved?.tradeCount ?? 0) + (m.declined?.tradeCount ?? 0);
      if (a == null || d == null || traded === 0 || d === 0) return false;
      return true;
    })
    .map(m => {
      const a = m.approved!.consensus as number;
      const d = m.declined!.consensus as number;
      const pct = ((a - d) / Math.abs(d)) * 100;
      return { name: m.metricName, pct, a, d };
    })
    .sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct));
  if (moves.length === 0) return '';
  const top = moves.slice(0, 2)
    .map(m => `${m.name}: ${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(1)}% (${formatNumber(m.d)} vs ${formatNumber(m.a)})`)
    .join('; ');
  const more = moves.length > 2 ? ` (+${moves.length - 2} more)` : '';
  return `${top}${more}`;
}

/**
 * Side-by-side branch comparison. Shows declined.consensus (counterfactual)
 * → approved.consensus (with the proposal) with the signed delta. The delta
 * is the calibrated causal estimate the product is built around.
 *
 * The two numbers are individually clickable: the decline value opens the
 * decline-branch market, the approve value opens the approve-branch market,
 * so the approver can drill into either side rather than always landing on
 * the approve branch.
 */
function ForecastCell({
  approved, declined, onOpenBranch,
}: {
  approved: number | null;
  declined: number | null;
  onOpenBranch: (branch: 'approved' | 'declined') => void;
}) {
  if (approved == null && declined == null) return <span className="forecast-empty">—</span>;

  const branchButton = (branch: 'approved' | 'declined', value: number, cls: string) => (
    <button
      type="button"
      className={`forecast-branch-link ${cls}`}
      title={branch === 'approved' ? 'Open the approve-branch market' : 'Open the decline-branch market'}
      onClick={(e) => { e.stopPropagation(); onOpenBranch(branch); }}
    >
      {formatNumber(value)}
    </button>
  );

  if (approved == null || declined == null) {
    const branch = approved != null ? 'approved' : 'declined';
    const value = (approved ?? declined) as number;
    return <span className="forecast-cell">{branchButton(branch, value, 'forecast-after')}</span>;
  }
  const delta = approved - declined;
  const deltaClass = Math.abs(delta) < 0.005
    ? 'forecast-delta--flat'
    : delta > 0 ? 'forecast-delta--up' : 'forecast-delta--down';
  const deltaLabel = Math.abs(delta) < 0.005
    ? '±0'
    : `${delta > 0 ? '+' : '-'}${Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 2 : 1)}`;
  return (
    <span className="forecast-cell" title={`Decline: ${formatNumber(declined)} / Approve: ${formatNumber(approved)}`}>
      {branchButton('declined', declined, 'forecast-before')}
      <span className="forecast-arrow">→</span>
      {branchButton('approved', approved, 'forecast-after')}
      <span className={`forecast-delta ${deltaClass}`}>{deltaLabel}</span>
    </span>
  );
}

/** Indent a row by its position in the metric tree. */
function depthPad(depth: number): React.CSSProperties {
  return { paddingLeft: `${0.4 + depth * 1.1}rem` };
}

/**
 * One leaf-metric market row: the existing per-(metric, targetDate) Decline ->
 * Approve forecast with individually clickable branch values.
 */
function LeafMarketRow({ m, depth, onOpenBranch }: {
  m: ProposalMarketSummary;
  depth: number;
  onOpenBranch: (marketId: string | undefined) => void;
}) {
  const tradeCount = (m.approved?.tradeCount ?? 0) + (m.declined?.tradeCount ?? 0);
  const noSignal = tradeCount === 0;
  const openMarket = () => onOpenBranch(m.approved?.marketId ?? m.declined?.marketId);
  return (
    <tr
      className={`predictions-row${noSignal ? ' no-signal' : ''}`}
      onClick={openMarket}
      tabIndex={0}
      role="button"
      aria-label={`Open market for ${m.metricName} at ${formatTargetDateDisplay(m.targetDate)}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMarket(); } }}
      style={{ cursor: 'pointer' }}
    >
      <td className="metric-name" style={depthPad(depth)}>{m.metricName}</td>
      <td className="horizon">{formatTargetDateDisplay(m.targetDate)}</td>
      <td className="num">
        <ForecastCell
          approved={m.approved?.consensus ?? null}
          declined={m.declined?.consensus ?? null}
          onOpenBranch={(branch) => onOpenBranch(branch === 'approved' ? m.approved?.marketId : m.declined?.marketId)}
        />
      </td>
      <td className="num">{noSignal ? <span className="no-signal-label">no signal</span> : tradeCount}</td>
    </tr>
  );
}

/**
 * A composite metric has no market of its own; it aggregates its leaf
 * descendants. We show its computed outlook (read-only) and route a click to
 * the Markets page filtered to all of its descendant leaf markets.
 */
function CompositeRow({ metric, marketCount, onOpenDescendants }: {
  metric: Metric;
  marketCount: number;
  onOpenDescendants: (metricId: string) => void;
}) {
  const open = () => onOpenDescendants(metric.id);
  const outlook = metric.total ?? metric.currentTotal ?? metric.value;
  return (
    <tr
      className="predictions-row predictions-row--composite"
      onClick={open}
      tabIndex={0}
      role="button"
      aria-label={`Show ${marketCount} descendant market${marketCount === 1 ? '' : 's'} under ${metric.name}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      style={{ cursor: 'pointer' }}
    >
      <td className="metric-name" style={depthPad(metric.depth ?? 0)}>
        <span className="composite-name">{metric.name}</span>
      </td>
      <td className="horizon">
        <span className="composite-descendants">{marketCount} market{marketCount === 1 ? '' : 's'} &rsaquo;</span>
      </td>
      <td className="num"><span className="composite-outlook">{formatNumber(outlook)}</span></td>
      <td className="num"></td>
    </tr>
  );
}

function PredictionsTable({ markets }: { markets: ProposalMarketSummary[] }) {
  const [showAll, setShowAll] = useState(false);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const navigate = useNavigate();

  // The metric tree (composites + ordering) isn't carried on the proposal, so
  // fetch the workspace metrics. enrichMetrics already returns them in tree
  // order (depth asc, then order asc) -- the same order the Metrics page shows.
  useEffect(() => {
    let cancelled = false;
    api.getMetrics()
      .then((rows: Metric[]) => { if (!cancelled) setMetrics(rows); })
      .catch((e: Error) => console.error('Failed to load metric tree for impact table', e));
    return () => { cancelled = true; };
  }, []);

  if (markets.length === 0) {
    return <p className="predictions-empty">No impact predictions yet. Click <strong>Inspect</strong> to spawn conditional markets.</p>;
  }

  // Open a specific branch market. The Markets page labels each conditional
  // market with an approve/decline branch badge so the approver knows which
  // side they landed on.
  const openBranch = (marketId: string | undefined) => {
    if (!marketId) return;
    navigate(`/markets?marketId=${encodeURIComponent(marketId)}&kind=conditional`);
  };

  // Composite click: jump to the Markets page filtered to this metric's
  // descendant leaf markets (conditional kind, matching the impact context).
  const openDescendants = (metricId: string) => {
    navigate(`/markets?kind=conditional&metric=${encodeURIComponent(metricId)}`);
  };

  const marketsByMetric = new Map<string, ProposalMarketSummary[]>();
  for (const m of markets) {
    const arr = marketsByMetric.get(m.metricId);
    if (arr) arr.push(m); else marketsByMetric.set(m.metricId, [m]);
  }

  // Build display rows in metric-tree order: each composite (higher in the
  // tree) first, then leaf market rows. Leaf rows keep the near-horizon filter.
  type Row =
    | { kind: 'composite'; metric: Metric; marketCount: number }
    | { kind: 'leaf'; market: ProposalMarketSummary; depth: number };
  const rows: Row[] = [];
  let hidden = 0;

  const pushLeaves = (summaries: ProposalMarketSummary[], depth: number) => {
    for (const m of summaries) {
      if (!showAll && !isNearHorizon(m.targetDate)) { hidden++; continue; }
      rows.push({ kind: 'leaf', market: m, depth });
    }
  };

  if (metrics.length > 0) {
    for (const metric of metrics) {
      if (isCompositeMetric(metric)) {
        const descIds = getLeafDescendantIds(metric.id, metrics);
        let count = 0;
        for (const id of descIds) count += marketsByMetric.get(id)?.length ?? 0;
        if (count > 0) rows.push({ kind: 'composite', metric, marketCount: count });
      } else {
        const summaries = marketsByMetric.get(metric.id);
        if (summaries && summaries.length) pushLeaves(summaries, metric.depth ?? 0);
      }
    }
    // Markets whose metric isn't in the tree (e.g. just deleted) still show,
    // flat, so the impact table never silently drops a priced market.
    const known = new Set(metrics.map(m => m.id));
    for (const [metricId, summaries] of marketsByMetric) {
      if (!known.has(metricId)) pushLeaves(summaries, 0);
    }
  } else {
    // Metrics not loaded yet: fall back to the flat leaf-only list.
    pushLeaves(markets, 0);
  }

  return (
    <div className="predictions-wrap">
      <table className="predictions-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Horizon</th>
            <th className="num">Decline → Approve</th>
            <th className="num">Trades</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => row.kind === 'composite' ? (
            <CompositeRow
              key={`c:${row.metric.id}`}
              metric={row.metric}
              marketCount={row.marketCount}
              onOpenDescendants={openDescendants}
            />
          ) : (
            <LeafMarketRow
              key={`${row.market.metricId}:${row.market.targetDate}`}
              m={row.market}
              depth={row.depth}
              onOpenBranch={openBranch}
            />
          ))}
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
              <span className="proposal-chat-content">{linkify(msg.content)}</span>
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

interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  confirmClass: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Styled approve/decline confirm. Replaces window.confirm() because the
 * approval moment is the load-bearing screen for the product — a native
 * dialog strips the forecast summary back to a single \n-joined string and
 * looks like a junior-class system prompt.
 */
function ConfirmModal({ open, title, body, confirmLabel, confirmClass, onConfirm, onCancel }: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div className="modal show" onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onCancel} aria-label="Cancel">&times;</button>
        </div>
        <div className="confirm-modal-body">{body}</div>
        <div className="confirm-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className={confirmClass} onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </div>
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

function SubsidyHeader({ proposal, isAdmin, onAdded, onError }: {
  proposal: ProposalDetailData;
  isAdmin: boolean;
  onAdded: () => void;
  onError: (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [amount, setAmount] = useState('');
  const subsidy = proposal.liquiditySubsidy ?? 0;
  const metricCount = proposal.marketCount ?? proposal.markets?.length ?? 0;
  // Each metric gets two LMSR markets (approved + declined branch). The
  // subsidy is charged per branch, so total credits debited is subsidy *
  // metricCount * 2. Use server-supplied branchMarketCount when available.
  const branchMarketCount = proposal.branchMarketCount ?? metricCount * 2;
  const total = Math.round(subsidy * branchMarketCount * 100) / 100;
  const isPending = proposal.status === 'pending';

  const handleAdd = async () => {
    const a = parseFloat(amount);
    if (!Number.isFinite(a) || a < 0.1) { onError('Amount must be at least 0.1 credits per market'); return; }
    setAdding(true);
    const result = await api.injectLiquidityBulk(a, proposal.id).catch((e: Error) => { onError(e.message); return null; });
    setAdding(false);
    if (result) {
      setAmount(''); setShowInput(false);
      onAdded();
    }
  };

  return (
    <div className="proposal-subsidy-line">
      {subsidy > 0 ? (
        <span>
          Subsidy <span className="proposal-subsidy-num">{subsidy.toFixed(2)}</span>/branch &middot;{' '}
          {metricCount} {metricCount === 1 ? 'metric' : 'metrics'} &times; 2 branches &middot;{' '}
          <span className="proposal-subsidy-num">{total.toFixed(2)} cr</span> total
        </span>
      ) : (
        <span className="proposal-subsidy-warn">
          No subsidy &mdash; conditional markets have zero liquidity, no forecast signal.
        </span>
      )}
      {isPending && isAdmin && (
        showInput ? (
          <span className="proposal-subsidy-input">
            <input
              type="number" step="any" min="0.1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="cr/market"
              autoFocus
            />
            <button type="button" className="link-button" disabled={adding || !amount} onClick={handleAdd}>
              {adding ? '…' : 'add'}
            </button>
            <button type="button" className="link-button" onClick={() => { setShowInput(false); setAmount(''); }}>cancel</button>
          </span>
        ) : (
          <button type="button" className="link-button" onClick={() => setShowInput(true)}>
            {subsidy > 0 ? 'top up' : 'add liquidity'}
          </button>
        )
      )}
    </div>
  );
}

function ProposalDrawer({ proposal, isAdmin, onClose, onAction, onError }: ProposalDrawerProps) {
  const { inspectProposal, setInspectProposal } = useInspectMode();
  const [acting, setActing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | 'approve' | 'decline'>(null);

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
          {proposal.description && <p className="proposal-description">{linkify(proposal.description)}</p>}

          <SubsidyHeader proposal={proposal} isAdmin={isAdmin} onAdded={onAction} onError={onError} />

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
                      onClick={() => setConfirmAction('approve')}
                    >
                      {acting ? '…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="btn-decline"
                      disabled={acting}
                      onClick={() => setConfirmAction('decline')}
                    >
                      {acting ? '…' : 'Decline'}
                    </button>
                  </>
                )}
              </div>
              <p className="proposal-actions-hint">
                {isAdmin
                  ? 'Approving voids the decline-counterfactual branch and refunds those stakes; the approve branch resolves against the actual metric at the target date. Declining is the mirror image.'
                  : 'Only workspace admins can approve or decline. Click Inspect to see how this proposal would shift each metric.'}
              </p>
            </div>
          )}

          <section className="proposal-drawer-section" data-tour-id="proposal-impact-section">
            <h4>Impact predictions</h4>
            <PredictionsTable markets={proposal.markets ?? []} />
          </section>
          <FirstSeenHint
            hintKey="proposal-impact"
            target='[data-tour-id="proposal-impact-section"]'
            title="Conditional markets"
            body={
              <>
                Rows follow your metric tree, higher metrics first. A leaf row
                pairs two markets: one prices the metric assuming this proposal
                is approved, the other assuming it is declined, and the arrow is
                the causal delta (decline to approve). A composite metric has no
                market of its own, so its row shows the computed outlook; click
                it to open every descendant market. Use <strong>Inspect</strong>{' '}
                above to overlay the approve-branch impact on your Metrics page.
              </>
            }
          />

          <section className="proposal-drawer-section">
            <h4>Discussion</h4>
            <ChatPanel proposalId={proposal.id} />
          </section>
        </div>
      </aside>

      <ConfirmModal
        open={confirmAction === 'approve'}
        title={`Approve "${proposal.title}"?`}
        body={(() => {
          const forecast = summarizeMarketsForConfirm(proposal.markets);
          return (
            <>
              <p className="confirm-modal-forecast">
                <span className="confirm-modal-label">Forecast:</span>{' '}
                {forecast ? forecast : <em>no market signal yet</em>}
              </p>
              <p className="confirm-modal-note">
                The approved-branch markets stay live and resolve against the actual metric at the target date. The declined-branch markets void and refund.
              </p>
            </>
          );
        })()}
        confirmLabel="Approve"
        confirmClass="btn-approve"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          setConfirmAction(null);
          handle(() => api.approveProposal(proposal.id));
        }}
      />

      <ConfirmModal
        open={confirmAction === 'decline'}
        title={`Decline "${proposal.title}"?`}
        body={
          <p className="confirm-modal-note">
            The approve-branch markets void and refund. The decline-branch markets stay live and resolve against the actual metric at the target date, producing the counterfactual record.
          </p>
        }
        confirmLabel="Decline"
        confirmClass="btn-decline"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          setConfirmAction(null);
          handle(() => api.declineProposal(proposal.id));
        }}
      />
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
  const { workspace } = useWorkspace();
  const wsId = workspace?.workspaceId;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subsidy, setSubsidy] = useState('');
  const [activeMarketCount, setActiveMarketCount] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || !wsId) return;
    setTitle(''); setDescription(''); setSubsidy(''); setCreating(false);
    api.getMarkets(undefined, wsId).catch(() => null).then(mkts => {
      const list = (mkts as Array<{ active?: boolean; proposalId?: string | null }> | null) ?? [];
      setActiveMarketCount(list.filter(m => m.active !== false && !m.proposalId).length);
    });
  }, [open, wsId]);

  if (!open) return null;

  const subsidyNumber = subsidy.trim() === '' ? 0 : parseFloat(subsidy);
  const subsidyValid = Number.isFinite(subsidyNumber) && subsidyNumber >= 0 && (subsidyNumber === 0 || subsidyNumber >= 0.1);
  // Each metric spawns two LMSR markets (approved + declined branch), so the
  // proposer is debited subsidy * metricCount * 2 upfront.
  const totalCost = activeMarketCount != null && subsidyNumber > 0
    ? Math.round(subsidyNumber * activeMarketCount * 2 * 100) / 100
    : 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title || !subsidyValid) return;
    setCreating(true);
    const result = await api.createProposal({
      title,
      description,
      liquiditySubsidy: subsidyNumber,
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
          <h3>New proposal</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="newProposalTitle">Title</label>
            <input
              id="newProposalTitle" type="text" required
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Hire 2 sales reps"
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
          <div className="form-group">
            <label htmlFor="newProposalSubsidy">Forecast subsidy (credits per branch market)</label>
            <input
              id="newProposalSubsidy"
              type="number"
              step="any"
              min="0"
              value={subsidy}
              onChange={e => setSubsidy(e.target.value)}
              placeholder="0"
            />
            <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {activeMarketCount == null ? (
                <span>Counting active markets…</span>
              ) : subsidyNumber > 0 ? (
                <span>
                  {subsidyNumber.toFixed(2)} cr/branch &times; {activeMarketCount} metrics &times; 2 branches ={' '}
                  <strong>{totalCost.toFixed(2)} credits</strong> debited from your balance.
                  Whichever branch (approve or decline) is not realised refunds in full;
                  the realised branch is at risk for up to {((totalCost / 2) * Math.LN2).toFixed(2)} credits.
                </span>
              ) : (
                <span style={{ color: 'var(--accent-text)' }}>
                  No subsidy, conditional markets will have zero liquidity, so traders see no point forecasting and the approve screen will say &ldquo;no signal&rdquo;.
                </span>
              )}
            </div>
            {!subsidyValid && (
              <div style={{ marginTop: '0.3rem', fontSize: '0.8rem', color: 'var(--error-text)' }}>
                Subsidy must be 0 or at least 0.1 credits per market.
              </div>
            )}
          </div>
          <button type="submit" className="btn" disabled={creating || !title || !subsidyValid}>
            {creating ? 'Proposing…' : 'Submit proposal'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function ProposalsPage() {
  const { user } = useAuth();
  const { workspace, allWorkspaces, switchWorkspace } = useWorkspace();
  const isAdmin = workspace?.tier === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openProposalId, setOpenProposalId] = useState<string | null>(null);
  const [openProposalData, setOpenProposalData] = useState<ProposalDetailData | null>(null);
  const [newProposalOpen, setNewProposalOpen] = useState(false);

  // Deep-link handoff from /participants/:id (and elsewhere): if
  // ?workspace=<id> names a workspace the user belongs to and it isn't the
  // active one, switch to it and reload at the same URL so ?id=<proposal>
  // resolves against the right workspace's proposals.
  useEffect(() => {
    const targetWs = searchParams.get('workspace');
    if (!targetWs || !workspace) return;
    if (targetWs === workspace.workspaceId) {
      const next = new URLSearchParams(searchParams);
      next.delete('workspace');
      setSearchParams(next, { replace: true });
      return;
    }
    if (allWorkspaces.some(w => w.id === targetWs)) {
      const next = new URLSearchParams(searchParams);
      next.delete('workspace');
      switchWorkspace(targetWs, `/proposals?${next.toString()}`);
    }
  }, [searchParams, workspace, allWorkspaces, switchWorkspace, setSearchParams]);

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

  // Auto-open the proposal drawer when ?id=<proposalId> is in the URL and
  // the proposal exists in the current workspace's list.
  useEffect(() => {
    const id = searchParams.get('id');
    if (!id || proposals.length === 0 || openProposalId === id) return;
    const proposal = proposals.find(p => p.id === id);
    if (!proposal) return;
    openProposal(proposal);
    const next = new URLSearchParams(searchParams);
    next.delete('id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, proposals]);

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
          <button type="button" className="btn" data-tour-id="proposals-new" onClick={() => setNewProposalOpen(true)}>
            + New proposal
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
              Propose the first one
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
              {proposals.map((proposal, idx) => (
                <tr
                  key={proposal.id}
                  className={`proposal-row${openProposalId === proposal.id ? ' proposal-row--active' : ''}`}
                  data-tour-id={idx === 0 ? 'proposals-first-row' : undefined}
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
