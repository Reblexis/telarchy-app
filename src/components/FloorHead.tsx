import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { possessiveOf } from '../lib/floor-horizons';
import { authPath } from '../lib/nextPath';
import { FloorModal } from './FloorModal';
import { Book, Drop, People, short } from './MarketFacts';

/**
 * The floor identity (docs/ui-conventions.md, "The floor head, the owner
 * row and the run-a-floor row"): the tiny FLOOR label with the floor's
 * facts as an icon row, the name in the display face, the one-liner under
 * it, and for the owner an Edit into the identity dialog. Under it, at
 * every width, the owner's row of three jobs or, for everyone else, the
 * one door to running a floor of their own.
 */

export interface FloorFacts {
  /** Distinct accounts that have traded on any of the floor's books. */
  traders: number;
  /** Credits in every open book on the floor. */
  poolCredits: number;
  /** Open baseline books. */
  books: number;
}

export function FloorHeadFacts({ facts }: { facts: FloorFacts }) {
  return (
    <span className="pubws-head-facts" aria-label="This floor">
      <span title="Distinct accounts that have traded on any book of this floor">
        <People /> {short(facts.traders)} traders
      </span>
      <span title="Credits in every open book on this floor">
        <Drop /> {short(facts.poolCredits)} cr in pools
      </span>
      <span title="Open books on this floor">
        <Book /> {facts.books} {facts.books === 1 ? 'book' : 'books'}
      </span>
    </span>
  );
}

export function FloorHead({
  workspaceId,
  name,
  description,
  facts,
  canManage,
  onSaved,
}: {
  workspaceId: string;
  name: string;
  description: string | null;
  facts: FloorFacts;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <header className="pubws-head">
      <div className="pubws-head-row">
        <span className="pubws-head-label">Floor</span>
        <FloorHeadFacts facts={facts} />
      </div>
      <h1 className="pubws-head-name">{name}</h1>
      {(description || canManage) && (
        <p className="pubws-head-line">
          {description}
          {canManage && (
            <button type="button" className="pubws-head-edit" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </p>
      )}
      {editing && (
        <IdentityDialog
          workspaceId={workspaceId}
          name={name}
          description={description}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
    </header>
  );
}

/** The identity dialog: the name and the one-liner, nothing else. */
function IdentityDialog({
  workspaceId,
  name: name0,
  description: description0,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  name: string;
  description: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(name0);
  const [line, setLine] = useState(description0 ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.updateWorkspaceSettings(workspaceId, { name: name.trim(), description: line.trim() || null });
      onSaved();
    } catch (e) {
      setErr((e as Error).message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <FloorModal onClose={onClose} label="Floor identity">
      <div className="ticket">
        <div className="ticket-head">
          <p className="ticket-label">Floor identity</p>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="jobform-field">
          <span className="ticket-label">Name</span>
          <input
            className="jobform-line"
            value={name}
            maxLength={60}
            onChange={e => setName(e.target.value)}
            aria-label="Floor name"
          />
        </label>
        <label className="jobform-field">
          <span className="ticket-label">One-liner</span>
          <input
            className="jobform-line"
            value={line}
            maxLength={140}
            onChange={e => setLine(e.target.value)}
            placeholder="What the company sells, in one line"
            aria-label="One-liner"
          />
        </label>
        {err && <p className="ticket-err">{err}</p>}
        <button className="ticket-go" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </FloorModal>
  );
}

/**
 * The owner row: the owner's three jobs, each a direct route, separated by
 * middle dots. The row is the owner's table of contents: every owner
 * action the page carries is reachable from it without scrolling.
 */
export function OwnerRow({
  report,
  decisions,
  onDecide,
  onManage,
}: {
  /** null when every metric on the floor is synced by the platform. */
  report: (() => void) | null;
  /** How many proposals count as needing the owner's decision. */
  decisions: number;
  onDecide: () => void;
  onManage: () => void;
}) {
  return (
    <div className="pubws-owner-row" role="group" aria-label="Your floor">
      {report ? (
        <button type="button" className="pubws-owner-row-go" onClick={report}>
          Report a number
        </button>
      ) : (
        <span className="pubws-owner-row-quiet">Readings synced hourly</span>
      )}
      <span className="pubws-owner-row-dot" aria-hidden="true">
        ·
      </span>
      {decisions > 0 ? (
        <button type="button" className="pubws-owner-row-go" onClick={onDecide}>
          {decisions} {decisions === 1 ? 'proposal needs' : 'proposals need'} your decision
        </button>
      ) : (
        <span className="pubws-owner-row-quiet">No proposal needs your decision</span>
      )}
      <span className="pubws-owner-row-dot" aria-hidden="true">
        ·
      </span>
      <button type="button" className="pubws-owner-row-go" onClick={onManage}>
        Manage books
      </button>
    </div>
  );
}

export const RUN_FLOOR_KEY = 'telarchy-run-floor';

/**
 * The run-a-floor row, for everyone who is not the owner: one ruled row,
 * and pressing it opens a panel in place with three underline fields and a
 * live rendering of the floor head they describe. Signed out the button
 * opens sign-up with the fields kept for after it; signed in it opens the
 * setup door with them prefilled.
 */
export function RunFloorRow({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState('Acme');
  const [metric, setMetric] = useState('Signups');
  const [value, setValue] = useState('41');
  const create = () => {
    const fields = { company, metric, value };
    try {
      sessionStorage.setItem(RUN_FLOOR_KEY, JSON.stringify(fields));
    } catch {
      /* private mode: the door still opens */
    }
    if (!signedIn) {
      navigate(authPath('signup', location));
      return;
    }
    const q = new URLSearchParams(fields).toString();
    navigate(`/waitlist?${q}`);
  };
  return (
    <>
      <div className="pubws-run-row">
        <button type="button" className="pubws-run-go" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          Run a floor for your company →
        </button>
        <span className="pubws-run-terms">free · you fund books in credits · prizes paid by Telarchy</span>
      </div>
      {open && (
        <div className="pubws-run-panel">
          <div className="pubws-run-fields">
            <label className="pubws-run-field">
              <span className="pubws-run-field-k">Company name</span>
              <input
                value={company}
                onChange={e => setCompany(e.target.value)}
                aria-label="Company name"
                maxLength={60}
              />
            </label>
            <label className="pubws-run-field">
              <span className="pubws-run-field-k">A number you run on</span>
              <input
                value={metric}
                onChange={e => setMetric(e.target.value)}
                aria-label="A number you run on"
                maxLength={60}
              />
            </label>
            <label className="pubws-run-field">
              <span className="pubws-run-field-k">Its value now</span>
              <input
                value={value}
                inputMode="decimal"
                onChange={e => setValue(e.target.value.replace(/[^0-9.,]/g, ''))}
                aria-label="Its value now"
                maxLength={16}
              />
            </label>
            <div className="pubws-run-facts" aria-label="What a floor costs">
              <span>Floor · free</span>
              <span>Books · funded in credits by you</span>
              <span>Proposals · paid in dollars only when you approve</span>
            </div>
            <div className="pubws-run-act">
              <button type="button" className="pubws-cta pubws-cta--small" onClick={create}>
                Create this floor
              </button>
              <Link className="pubws-run-guide" to="/guides">
                How Telarchy works
              </Link>
            </div>
          </div>
          <div className="pubws-run-preview" aria-label="Your floor, as it would look">
            <span className="pubws-head-label">Floor</span>
            <p className="pubws-head-name">{company.trim() || 'Your company'}</p>
            <p className="pubws-run-preview-q">
              What will be {possessiveOf(company.trim() || 'your company')} {metric.trim() || 'number'} this month?
            </p>
            <div className="pubws-numbers pubws-numbers--mini">
              <div className="pubws-stat-block pubws-stat--call">
                <span className="pubws-stat-what">market's call · opens at</span>
                <span className="pubws-price">{value.trim() || '0'}</span>
                <span className="pubws-stat-note">opens at {value.trim() || '0'}</span>
              </div>
              <div className="pubws-stat-block pubws-stat--now">
                <span className="pubws-stat-cap">
                  <span className="pubws-stat-what">now · reported by you</span>
                  <span className="pubws-stat-report" aria-hidden="true">
                    Report
                  </span>
                </span>
                <span className="pubws-price">{value.trim() || '0'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
