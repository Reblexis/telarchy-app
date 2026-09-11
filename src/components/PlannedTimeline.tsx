import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PlannedResponse, type TimelineItem } from '../lib/api';
import { endMeta, layout, type PlacedRow, type Range } from '../lib/timeline-model';
import { FloorModal } from './FloorModal';

/**
 * "What is planned": the owner's calendar in the data room
 * (docs/data-room.md, "What is planned"; docs/ui-conventions.md, "The data
 * room", the PlannedTimeline paragraph).
 *
 * The log says what happened; this says what is supposed to happen next, so
 * a trader reading the room knows what the number is being pushed by before
 * it moves. It draws exactly what `GET /api/data-room/planned` returns: the
 * platform floor's commitments, one row each, its title on a line with a
 * meta naming the end, its bar on the shared axis beneath, soonest end on
 * top; the first eight rows, the rest behind "All N"; and what has no date
 * listed under the axis. The geometry is `lib/timeline-model.ts`; this
 * component fetches, measures the axis width and paints.
 *
 * It never renders nothing: in the room, "nothing planned" is a fact worth
 * reading, so the head and one line stay for everyone.
 */

const FALLBACK_WIDTH = 280;
/** Two dozen open commitments must not push the log off the first screen. */
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

export function PlannedTimeline({
  canManage,
  workspaceId,
  onWorkspace,
  initialNow,
}: {
  /** Whether the reader manages the floor whose calendar this is. */
  canManage: boolean;
  /** The floor the owner's controls write to; null until the page knows it. */
  workspaceId: string | null;
  /** Called with the floor the endpoint answered for (or null on a fresh
   *  instance), so the page can ask who the reader is on that floor. */
  onWorkspace?: (ws: PlannedResponse['workspace']) => void;
  /** The clock to lay out around; tests pin it, the room leaves it to the server's `now`. */
  initialNow?: Date;
}) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [workspace, setWorkspace] = useState<PlannedResponse['workspace']>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<Range>('week');
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [adding, setAdding] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const [openWords, setOpenWords] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => initialNow ?? new Date());
  const axisRef = useRef<HTMLDivElement | null>(null);

  // The parent's callback is read through a ref so a page that recreates it
  // on every render does not refetch the calendar on every render.
  const onWorkspaceRef = useRef(onWorkspace);
  onWorkspaceRef.current = onWorkspace;

  // One fetcher for mount and for every refetch after a plan changes. The
  // generation counter drops a reply that lands after unmount or after a
  // newer request, so a slow first answer cannot overwrite a fresh one.
  const generation = useRef(0);
  const load = useCallback(() => {
    const mine = ++generation.current;
    return api
      .getDataRoomPlanned()
      .then(r => {
        if (mine !== generation.current) return;
        setItems(r.items ?? []);
        setWorkspace(r.workspace ?? null);
        setFailed(false);
        // The server's clock places the now-line; a visitor's skewed clock should not.
        if (!initialNow && r.now) {
          const t = Date.parse(r.now);
          if (!Number.isNaN(t)) setNow(new Date(t));
        }
        onWorkspaceRef.current?.(r.workspace ?? null);
      })
      .catch(() => {
        if (mine !== generation.current) return;
        setItems([]);
        setFailed(true);
      });
  }, [initialNow]);

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

  // The owner's controls need a floor to write to; a manager whose floor id
  // has not arrived yet is a reader for now.
  const writes = canManage && workspaceId ? workspaceId : null;

  const markDone = (it: TimelineItem) => {
    if (!writes) return;
    void api
      .updatePlan(writes, it.id, { done: true })
      .then(() => load())
      .catch(() => load());
  };

  const wordsOf = (items ?? []).find(i => i.id === openWords);
  const shown = unfolded ? lay.rows : lay.rows.slice(0, FOLD_AT);
  const folded = lay.rows.length - shown.length;

  const doneTick = (it: TimelineItem) =>
    writes && it.kind === 'plan' ? (
      <button
        type="button"
        className="dr-tl-done"
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
        <span className="dr-tl-line">
          <span className="dr-tl-title">{it.title}</span>
          <span className="dr-tl-meta">{endMeta(it, now)}</span>
        </span>
        <span className="dr-tl-track">
          <span
            className={
              `dr-tl-bar dr-tl-bar--${it.kind}` +
              (row.openLeft ? ' dr-tl-bar--open-left' : '') +
              (row.openRight ? ' dr-tl-bar--open-right' : '')
            }
            style={{ left: row.left, width: row.width }}
          />
        </span>
      </>
    );
    return (
      <li className="dr-tl-row" key={it.id}>
        {it.href ? (
          <Link className="dr-tl-rowlink" to={it.href}>
            {body}
          </Link>
        ) : (
          <button
            type="button"
            className="dr-tl-rowlink"
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

  const loading = items === null;
  const nothingAtAll = !loading && !failed && items.length === 0;
  const nothingInRange = !loading && !failed && items.length > 0 && lay.rows.length === 0;

  return (
    <section className="dr-planned" aria-label="What is planned">
      {/* Same anatomy as the log's day rules: mono label, the floor's name as
          the meta, hairline under. The floor is named so nobody mistakes
          this for every floor's plans. */}
      <div className="dr-tl-head">
        <h2 className="dr-tl-label">What is planned</h2>
        {workspace && <span className="dr-tl-floor">{workspace.name}</span>}
        <span className="dr-tl-corner">
          {writes && (
            <button type="button" className="dr-tl-act" onClick={() => setAdding(true)}>
              + plan
            </button>
          )}
          {(folded > 0 || (unfolded && lay.rows.length > FOLD_AT)) && (
            <button type="button" className="dr-tl-act" onClick={() => setUnfolded(u => !u)}>
              {unfolded ? 'Fewer' : `All ${lay.rows.length}`}
            </button>
          )}
        </span>
      </div>

      {!loading && (
        <div className="dr-tl-controls">
          <span className="pubws-seg dr-tl-seg" role="group" aria-label="Range">
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
          <span className="dr-tl-range">{rangeMeta(range, lay.from, lay.to)}</span>
        </div>
      )}

      {/* Nothing planned and nothing loading are different facts, as with the log. */}
      {failed && <p className="dr-tl-empty">The calendar would not open.</p>}
      {nothingAtAll && <p className="dr-tl-empty">Nothing planned yet.</p>}
      {!loading && !failed && !nothingAtAll && (
        <div className="dr-tl-axis" ref={axisRef}>
          <div className="dr-tl-ticks" aria-hidden="true">
            {lay.ticks.map(t => (
              <span key={t.t} className="dr-tl-tick" style={{ left: t.x }}>
                {t.label}
              </span>
            ))}
          </div>
          <div className="dr-tl-rows">
            {/* Everything left of now is spent time; shading it makes the
                now-line read as a boundary rather than a stray rule. */}
            {lay.pastWidth > 0 && <div className="dr-tl-past" style={{ width: lay.pastWidth }} aria-hidden="true" />}
            {lay.nowX !== null && <div className="dr-tl-now" style={{ left: lay.nowX }} aria-hidden="true" />}
            {nothingInRange ? (
              <p className="dr-tl-empty dr-tl-empty--range">Nothing in this range.</p>
            ) : (
              <ul className="dr-tl-list">{shown.map(rowEl)}</ul>
            )}
          </div>
        </div>
      )}

      {wordsOf && (
        <p className="dr-tl-words">
          <strong>{wordsOf.title}</strong>
          {wordsOf.description ? ` ${wordsOf.description}` : ' No notes.'}
        </p>
      )}

      {lay.undated.length > 0 && (
        <div className="dr-tl-undated">
          <span className="dr-tl-undated-head">No date</span>
          <ul className="dr-tl-undated-list">
            {lay.undated.map(it => (
              <li key={it.id} className="dr-tl-undated-row">
                {it.href ? (
                  <Link className="dr-tl-undated-title" to={it.href}>
                    {it.title}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="dr-tl-undated-title"
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

      {adding && writes && (
        <AddPlanDialog
          workspaceId={writes}
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

/** One form, the four fields, one ink button (docs/data-room.md, "Plan
 *  items"). Built like AddDateDialog: a FloorModal around a jobform. */
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
            className="jobform-line dr-tl-words-field"
            value={description}
            rows={3}
            placeholder="Optional. Markdown."
            onChange={e => setDescription(e.target.value)}
          />
        </label>
        <div className="dr-tl-when">
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
