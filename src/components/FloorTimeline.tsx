import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type TimelineItem } from '../lib/api';
import { endMeta, layout, type PlacedRow, type Range } from '../lib/timeline-model';
import { FloorModal } from './FloorModal';

/**
 * "What is planned": the owner's calendar on the floor
 * (docs/owner-on-the-floor.md, "What is planned"; docs/ui-conventions.md,
 * the FloorTimeline paragraph).
 *
 * A trader can read what the floor would do if a proposal were approved;
 * what they could not read is what the owner has actually committed to and
 * by when. This draws exactly what `GET /api/marketplace/:id/timeline`
 * returns: one row per commitment, its title on a line with a meta naming
 * the end, its bar on the shared axis beneath, soonest end on top; the
 * first eight rows, the rest behind "All N"; and what has no date listed
 * under the axis. The geometry is `lib/timeline-model.ts`; this component
 * fetches, measures the axis width and paints.
 *
 * It renders nothing when there is nothing planned and the visitor cannot
 * manage, the announcements' rule: an empty heading on every floor is
 * furniture.
 */

const FALLBACK_WIDTH = 280;
/** A floor with two dozen open commitments is still a card, not a page. */
const FOLD_AT = 8;

const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function rangeMeta(range: Range, from: number, to: number): string {
  if (range === 'today') return `Today · ${fmtDay(from)}`;
  // The window's last instant is the next midnight; name the last day, not the day after it.
  return `${fmtDay(from)} to ${fmtDay(to - 1)}`;
}

/** datetime-local is wall-clock in the browser's zone; the API wants an instant. */
function localToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function FloorTimeline({
  idOrSlug,
  workspaceId,
  canManage,
  initialNow,
}: {
  /** What the public read route is addressed by, the same thing the floor was loaded with. */
  idOrSlug: string;
  workspaceId: string;
  canManage: boolean;
  /** The clock to lay out around; tests pin it, the floor leaves it to the server's `now`. */
  initialNow?: Date;
}) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<Range>('week');
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [adding, setAdding] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const [openWords, setOpenWords] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => initialNow ?? new Date());
  const axisRef = useRef<HTMLDivElement | null>(null);

  // One fetcher for mount and for every refetch after a plan changes. The
  // generation counter drops a reply that lands after unmount or after a
  // newer request, so a slow first answer cannot overwrite a fresh one.
  const generation = useRef(0);
  const load = useCallback(() => {
    const mine = ++generation.current;
    return (
      api
        .getWorkspaceTimeline(idOrSlug)
        .then(r => {
          if (mine !== generation.current) return;
          setItems(r.items ?? []);
          setFailed(false);
          // The server's clock places the now-line; a visitor's skewed clock should not.
          if (!initialNow && r.now) {
            const t = Date.parse(r.now);
            if (!Number.isNaN(t)) setNow(new Date(t));
          }
        })
        // Silent on purpose: a 403 on a private floor is the disclosure rule
        // working, and the floor's job is the market, not an error about plans.
        .catch(() => {
          if (mine !== generation.current) return;
          setItems([]);
          setFailed(true);
        })
    );
  }, [idOrSlug, initialNow]);

  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  // The axis is as wide as the column gives it; measure rather than guess,
  // and keep measuring as the column reflows. jsdom has no ResizeObserver
  // and reports zero widths, so it keeps the fallback.
  useLayoutEffect(() => {
    const el = axisRef.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    read();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  const lay = useMemo(() => layout(items ?? [], range, now, width), [items, range, now, width]);

  if (items === null) return null;
  if (failed) return null;
  if (items.length === 0 && !canManage) return null;

  const markDone = (it: TimelineItem) => {
    void api
      .updatePlan(workspaceId, it.id, { done: true })
      .then(() => load())
      .catch(() => load());
  };

  const wordsOf = items.find(i => i.id === openWords);
  const shown = unfolded ? lay.rows : lay.rows.slice(0, FOLD_AT);
  const folded = lay.rows.length - shown.length;

  const doneTick = (it: TimelineItem) =>
    canManage && it.kind === 'plan' ? (
      <button
        type="button"
        className="pubws-tl-done"
        aria-label={`Mark done: ${it.title}`}
        title="Mark done"
        onClick={() => markDone(it)}
      >
        ✓
      </button>
    ) : null;

  const rowEl = (row: PlacedRow) => {
    const it = row.item;
    const body = (
      <>
        <span className="pubws-tl-line">
          <span className="pubws-tl-title">{it.title}</span>
          <span className="pubws-tl-meta">{endMeta(it, now)}</span>
        </span>
        <span className="pubws-tl-track">
          <span
            className={
              `pubws-tl-bar pubws-tl-bar--${it.kind}` +
              (row.openLeft ? ' pubws-tl-bar--open-left' : '') +
              (row.openRight ? ' pubws-tl-bar--open-right' : '')
            }
            style={{ left: row.left, width: row.width }}
          />
        </span>
      </>
    );
    return (
      <li className="pubws-tl-row" key={it.id}>
        {it.href ? (
          <Link className="pubws-tl-rowlink" to={it.href}>
            {body}
          </Link>
        ) : (
          <button
            type="button"
            className="pubws-tl-rowlink"
            aria-expanded={openWords === it.id}
            onClick={() => setOpenWords(openWords === it.id ? null : it.id)}
          >
            {body}
          </button>
        )}
        {doneTick(it)}
      </li>
    );
  };

  const nothingAtAll = items.length === 0;
  const nothingInRange = !nothingAtAll && lay.rows.length === 0;

  return (
    <section className="pubws-know pubws-enter pubws-enter--3 pubws-tl" aria-label="What is planned">
      <div className="pubws-lb-head">
        <h2 className="pubws-h2">What is planned</h2>
        <span className="pubws-lb-meta">{rangeMeta(range, lay.from, lay.to)}</span>
      </div>
      <div className="pubws-tl-controls">
        <span className="pubws-seg pubws-tl-seg" role="group" aria-label="Range">
          {(['today', 'week', 'month'] as Range[]).map(r => (
            <button
              key={r}
              type="button"
              className={`pubws-seg-btn${range === r ? ' is-active' : ''}`}
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {r === 'today' ? 'Today' : r === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </span>
        <span className="pubws-tl-corner">
          {canManage && (
            <button type="button" className="pubws-know-edit" onClick={() => setAdding(true)}>
              + plan
            </button>
          )}
          {(folded > 0 || (unfolded && lay.rows.length > FOLD_AT)) && (
            <button type="button" className="pubws-know-edit" onClick={() => setUnfolded(u => !u)}>
              {unfolded ? 'Fewer' : `All ${lay.rows.length}`}
            </button>
          )}
        </span>
      </div>

      {nothingAtAll ? (
        <p className="pubws-tl-empty">Nothing planned yet.</p>
      ) : (
        <div className="pubws-tl-axis" ref={axisRef}>
          <div className="pubws-tl-ticks" aria-hidden="true">
            {lay.ticks.map(t => (
              <span key={t.t} className="pubws-tl-tick" style={{ left: t.x }}>
                {t.label}
              </span>
            ))}
          </div>
          <div className="pubws-tl-rows">
            {/* Everything left of now is spent time; shading it makes the
                now-line read as a boundary rather than a stray rule. */}
            {lay.pastWidth > 0 && <div className="pubws-tl-past" style={{ width: lay.pastWidth }} aria-hidden="true" />}
            {lay.ticks.map(t => (
              <div key={`g${t.t}`} className="pubws-tl-grid" style={{ left: t.x }} aria-hidden="true" />
            ))}
            {lay.nowX !== null && <div className="pubws-tl-now" style={{ left: lay.nowX }} aria-hidden="true" />}
            {nothingInRange ? (
              <p className="pubws-tl-empty pubws-tl-empty--range">Nothing in this range.</p>
            ) : (
              <ul className="pubws-tl-list">{shown.map(rowEl)}</ul>
            )}
          </div>
        </div>
      )}

      {wordsOf && (
        <p className="pubws-tl-words">
          <strong>{wordsOf.title}</strong>
          {wordsOf.description ? ` ${wordsOf.description}` : ' No notes.'}
        </p>
      )}

      {lay.undated.length > 0 && (
        <div className="pubws-tl-undated">
          <span className="pubws-tl-undated-head">No date</span>
          <ul className="pubws-tl-undated-list">
            {lay.undated.map(it => (
              <li key={it.id} className="pubws-tl-undated-row">
                {it.href ? (
                  <Link className="pubws-tl-undated-title" to={it.href}>
                    {it.title}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="pubws-tl-undated-title"
                    onClick={() => setOpenWords(openWords === it.id ? null : it.id)}
                  >
                    {it.title}
                  </button>
                )}
                {doneTick(it)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding && (
        <AddPlanDialog
          workspaceId={workspaceId}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
    </section>
  );
}

/** One form, the four fields, one ink button (docs/owner-on-the-floor.md,
 *  "Plan items"). Built like AddDateDialog: a FloorModal around a jobform. */
function AddPlanDialog({
  workspaceId,
  onClose,
  onDone,
}: {
  workspaceId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      setErr('Give it a title.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.createPlan(workspaceId, {
        title: t,
        description: description.trim() || undefined,
        start: localToIso(start),
        due: localToIso(due),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <FloorModal onClose={onClose} label="Add a plan">
      <div className="jobform">
        <div className="ticket-head jobform-head">
          <p className="ticket-label">Add to the plan</p>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="jobform-field">
          <span className="ticket-label">Title</span>
          <input
            className="jobform-line jobform-line--title"
            value={title}
            maxLength={200}
            placeholder="Write the September results post"
            onChange={e => setTitle(e.target.value)}
          />
        </label>
        <label className="jobform-field">
          <span className="ticket-label">What it is</span>
          <textarea
            className="jobform-line pubws-tl-words-field"
            value={description}
            rows={3}
            placeholder="Optional. Markdown."
            onChange={e => setDescription(e.target.value)}
          />
        </label>
        <div className="pubws-tl-when">
          <label className="jobform-field">
            <span className="ticket-label">Start</span>
            <input
              type="datetime-local"
              className="jobform-line odlg-mono"
              value={start}
              onChange={e => setStart(e.target.value)}
            />
          </label>
          <label className="jobform-field">
            <span className="ticket-label">Due</span>
            <input
              type="datetime-local"
              className="jobform-line odlg-mono"
              value={due}
              onChange={e => setDue(e.target.value)}
            />
          </label>
        </div>
        {err && <p className="ticket-err">{err}</p>}
        <button className="ticket-go" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Adding…' : 'Add to the plan'}
        </button>
      </div>
    </FloorModal>
  );
}
