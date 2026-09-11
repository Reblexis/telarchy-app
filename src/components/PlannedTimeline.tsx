import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, type PlannedResponse, type TimelineItem } from '../lib/api';
import { endMeta, layout, type PlacedRow, type Range } from '../lib/timeline-model';

/**
 * "What is planned": the data room's second tab (docs/data-room.md, "What is
 * planned"; docs/ui-conventions.md, "The data room", the PlannedTimeline
 * paragraph).
 *
 * It draws exactly what `GET /api/data-room/planned` returns: the entries
 * the owner of the platform floor typed, one row per open entry, its title
 * on a line with the due meta at its end, its bar on the shared axis
 * beneath, soonest due on top; the first eight rows, the rest behind
 * "All N"; and the open entries with no date listed under the axis. The
 * geometry is `lib/timeline-model.ts`; this component fetches, measures the
 * axis width and paints.
 *
 * Read-only for everyone, the owner included: entries are written in the
 * cockpit (`/admin`, "Plans"), so the room can never be the place a plan
 * is quietly changed.
 */

const FALLBACK_WIDTH = 280;
/** Two dozen open entries must not become a wall; the rest are one tap away. */
const FOLD_AT = 8;

const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function rangeMeta(range: Range, from: number, to: number): string {
  if (range === 'today') return `Today · ${fmtDay(from)}`;
  // The window's last instant is the next midnight; name the last day, not the day after it.
  return `${fmtDay(from)} to ${fmtDay(to - 1)}`;
}

export function PlannedTimeline({
  initialNow,
}: {
  /** The clock to lay out around; tests pin it, the room leaves it to the server's `now`. */
  initialNow?: Date;
}) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [workspace, setWorkspace] = useState<PlannedResponse['workspace']>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<Range>('week');
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [unfolded, setUnfolded] = useState(false);
  const [openWords, setOpenWords] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => initialNow ?? new Date());
  const axisRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getDataRoomPlanned()
      .then(r => {
        if (!live) return;
        setItems(r.items ?? []);
        setWorkspace(r.workspace ?? null);
        // The server's clock places the now-line; a visitor's skewed clock should not.
        if (!initialNow && r.now) {
          const t = Date.parse(r.now);
          if (!Number.isNaN(t)) setNow(new Date(t));
        }
      })
      .catch(() => {
        if (!live) return;
        setItems([]);
        setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [initialNow]);

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

  // A done entry has left the axis (its interval is over, the log holds the
  // history), so only the open ones count here, the empty line included.
  const open = useMemo(() => (items ?? []).filter(i => !i.done), [items]);
  const lay = useMemo(() => layout(open, range, now, width), [open, range, now, width]);

  const toggle = (id: string) => setOpenWords(cur => (cur === id ? null : id));
  const wordsOf = open.find(i => i.id === openWords);
  const shown = unfolded ? lay.rows : lay.rows.slice(0, FOLD_AT);
  const folded = lay.rows.length - shown.length;

  const rowEl = (row: PlacedRow) => {
    const it = row.item;
    return (
      <li className="dr-tl-row" key={it.id}>
        <button
          type="button"
          className="dr-tl-rowlink"
          aria-expanded={openWords === it.id}
          onClick={() => toggle(it.id)}
        >
          <span className="dr-tl-line">
            <span className="dr-tl-title">{it.title}</span>
            <span className="dr-tl-meta">{endMeta(it, now)}</span>
          </span>
          <span className="dr-tl-track">
            <span
              className={
                'dr-tl-bar' +
                (row.openLeft ? ' dr-tl-bar--open-left' : '') +
                (row.openRight ? ' dr-tl-bar--open-right' : '')
              }
              style={{ left: row.left, width: row.width }}
            />
          </span>
        </button>
      </li>
    );
  };

  const loading = items === null;
  const nothingAtAll = !loading && !failed && open.length === 0;
  const nothingInRange = !loading && !failed && lay.rows.length === 0;

  return (
    <section className="dr-planned" aria-label="What is planned">
      {/* Same anatomy as the log's day rules: mono label, the floor's name as
          the meta, hairline under. The floor is named so nobody mistakes
          this for every floor's plans. */}
      <div className="dr-tl-head">
        <h2 className="dr-tl-label">What is planned</h2>
        {workspace && <span className="dr-tl-floor">{workspace.name}</span>}
        {(folded > 0 || (unfolded && lay.rows.length > FOLD_AT)) && (
          <span className="dr-tl-corner">
            <button type="button" className="dr-tl-act" onClick={() => setUnfolded(u => !u)}>
              {unfolded ? 'Fewer' : `All ${lay.rows.length}`}
            </button>
          </span>
        )}
      </div>

      {!loading && !failed && !nothingAtAll && (
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
                <button
                  type="button"
                  className="dr-tl-undated-title"
                  aria-expanded={openWords === it.id}
                  onClick={() => toggle(it.id)}
                >
                  {it.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
