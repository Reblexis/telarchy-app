import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type SnakeAction,
  type SnakeCell,
  type SnakeGame,
  type SnakeHeading,
  type SnakeHistoryStep,
  type SnakeState,
} from '../../lib/api';
import type { FeedQuotes } from '../../lib/feed-overlay';

/**
 * The snake feed, drawn natively on the floor (docs/ui-conventions.md, "The
 * live view is a segment of the chart slot", "The snake feed"): the grid,
 * one next-move line, the why line and the three picks (2026-09-11);
 * under them the replay: a game picker, a scrubber, play, a speed, and
 * LIVE.
 *
 * Realtime polls GET /api/marketplace/:slug/live every 2 seconds while the
 * tab is visible, and keeps polling during replay so LIVE is instant. A move
 * TRANSITIONS to its new cells rather than snapping (the band's `d`, the
 * head's transform, a chevron's shading, all in the stylesheet off
 * `data-motion`), and a read that fails leaves the last board drawn.
 * Replay indexes ENTRIES of the recording (/history's `total` and `from`),
 * never move numbers: a partial game's entry 0 is a step far above 0.
 * Windows of 300 entries are kept per game by entry index. No library: an
 * svg, a range input and a timer.
 */

const POLL_MS = 2_000;
/** A read older than this is stale: said on the line, no countdown. */
const STALE_S = 8;
const WINDOW = 300;
/** Drawing units per cell; the svg scales to its box. */
const CELL = 24;

const ACTIONS: SnakeAction[] = ['forward', 'left', 'right'];
/** The action in words, as the next-move line prints it. */
const ACTION_WORDS: Record<SnakeAction, string> = {
  forward: 'continue forward',
  left: 'turn left',
  right: 'turn right',
};
/** The action in the past, as the replay line prints it. */
const ACTION_PAST: Record<SnakeAction, string> = {
  forward: 'continued forward',
  left: 'turned left',
  right: 'turned right',
};

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Whether the open step is ONE proposal with an option per action (the
 * current feed: `open.proposal`, and per action `price` and `lead`), rather
 * than the older one two-branch proposal per action (docs/guides/
 * proposals.md, "More than two options").
 */
function isOneProposal(state: SnakeState | null): boolean {
  return !!state?.open?.proposal?.id;
}

/**
 * An action's 60-move number, as the chips print it and the chevrons shade
 * by: on the one proposal the option's `lead` (its consensus minus the best
 * other option), on the older per-action pairs approved minus declined. Null
 * while unreadable.
 */
function impactOf(state: SnakeState, action: SnakeAction): number | null {
  const q = state.open?.quotes?.[action]?.m60;
  if (!q) return null;
  if (isOneProposal(state)) return typeof q.lead === 'number' && Number.isFinite(q.lead) ? q.lead : null;
  if (typeof q.approved !== 'number' || typeof q.declined !== 'number') return null;
  return q.approved - q.declined;
}

/** The proposal number an action's chevron and chip link to: the one
 *  proposal's, or on the older shape that action's own. */
function numberFor(state: SnakeState | null, action: SnakeAction): number | null {
  const open = state?.open;
  if (!open) return null;
  if (open.proposal?.id) {
    const n = open.proposal.number;
    return typeof n === 'number' && Number.isFinite(n) ? n : proposalNumberOf(open.proposal.url);
  }
  return proposalNumberOf(open.proposals?.[action]?.url);
}

/**
 * A move transitions, it does not snap (docs/ui-conventions.md, "The live
 * view is a segment of the chart slot", item 1): the band is one PATH, whose
 * `d` a CSS transition can interpolate, where a polyline's `points` cannot be
 * animated at all. A one-cell snake draws a dot, a lineto onto its own point
 * that the round cap paints.
 */
function bandPath(points: ReadonlyArray<readonly [number, number]>): string {
  const at = ([x, y]: readonly [number, number]) => `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`;
  if (points.length === 0) return '';
  if (points.length === 1) return `M${at(points[0])}L${at(points[0])}`;
  return `M${at(points[0])}${points
    .slice(1)
    .map(pt => `L${at(pt)}`)
    .join('')}`;
}

/** A reader who asked for less motion gets none: the board says so and every
 *  transition hangs off that word. */
function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  } catch {
    return false;
  }
}

/** One cell of travel per compass direction. */
const DELTA: Record<SnakeHeading, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const HEADINGS: SnakeHeading[] = ['up', 'down', 'left', 'right'];

/** One chevron on the grid (docs/ui-conventions.md, "The snake feed", the
 *  grid): the direction it points, how solid it draws (`opacity`, the
 *  open step's impact shading, 1 once decided), and, for an open action,
 *  the action and the proposal it links to on this floor. */
export type Arrow = {
  direction: SnakeHeading;
  decided: boolean;
  opacity: number;
  action?: SnakeAction;
  number?: number;
  href?: string;
};

/** The proposal number a feed url names ("https://telarchy.com/snake/p/122"), or null. */
export function proposalNumberOf(url: string | null | undefined): number | null {
  const m = /\/p\/(\d+)(?:[/?#]|$)/.exec(url ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * How bright each open action's chevron draws: the highest impact at 0.9,
 * the lowest at 0.3, the rest in proportion, and 0.55 for all when the
 * impacts tie or any is unreadable (docs/ui-conventions.md, "The snake
 * feed"; Viktor 2026-09-11: "make the highlight of the arrows depend on how
 * high the predicted impact is").
 */
export function arrowOpacities(impacts: Array<number | null>): number[] {
  const nums = impacts.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length !== impacts.length || nums.length === 0) return impacts.map(() => 0.55);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max === min) return impacts.map(() => 0.55);
  return nums.map(v => 0.3 + 0.6 * ((v - min) / (max - min)));
}

/**
 * The chevrons' brightness on the one proposal: as `arrowOpacities` over the
 * priced options, and an unpriced option (a null lead) at the faint end,
 * because nothing is staked on it. Fewer than two priced, or all priced
 * equal, is the tie's 0.55 for every chevron.
 */
export function leadOpacities(leads: Array<number | null>): number[] {
  const nums = leads.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 2) return leads.map(() => 0.55);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max === min) return leads.map(() => 0.55);
  return leads.map(v => (typeof v === 'number' && Number.isFinite(v) ? 0.3 + 0.6 * ((v - min) / (max - min)) : 0.3));
}

/** The stroke every mark is drawn with. Thin: the mark is a pointer, not a
 *  block, and at a four-cell board one cell is most of the picture. */
const ARROW_STROKE = CELL * 0.055;

/** The arrow, as path data: a shaft from just outside the head's cell to
 *  three quarters into the cell the move leads to, and a head at its end.
 *  It points from the snake to where that move would take it, so it reads
 *  as a move rather than as a mark floating in a square. */
function arrowPath(hx: number, hy: number, direction: SnakeHeading): string {
  const [dx, dy] = DELTA[direction];
  const [px, py] = [-dy, dx];
  const fx = hx + dx * CELL * 0.56;
  const fy = hy + dy * CELL * 0.56;
  const tx = hx + dx * CELL * 1.24;
  const ty = hy + dy * CELL * 1.24;
  const a = CELL * 0.15;
  const n = (v: number) => Number(v.toFixed(2));
  return [
    `M ${n(fx)} ${n(fy)} L ${n(tx)} ${n(ty)}`,
    `M ${n(tx - dx * a + px * a * 0.8)} ${n(ty - dy * a + py * a * 0.8)}`,
    `L ${n(tx)} ${n(ty)}`,
    `L ${n(tx - dx * a - px * a * 0.8)} ${n(ty - dy * a - py * a * 0.8)}`,
  ].join(' ');
}

/** The wall, as path data: a bar hugging the board's edge across the head's
 *  cell, inset by half a stroke so nothing is painted outside the board
 *  (docs/ui-conventions.md, "The snake feed"). A move with no cell to point
 *  into is drawn as the wall it would hit. */
function wallBar(hx: number, hy: number, direction: SnakeHeading): string {
  const [dx, dy] = DELTA[direction];
  const [px, py] = [-dy, dx];
  // Flush inside the border: the head's band reaches 0.36 of a cell from its
  // centre, so a bar any further in would sit on the snake instead of on the
  // wall it stands for.
  const off = CELL * 0.5 - ARROW_STROKE / 2;
  const half = CELL * 0.34;
  const cx = hx + dx * off;
  const cy = hy + dy * off;
  const n = (v: number) => Number(v.toFixed(2));
  return `M ${n(cx + px * half)} ${n(cy + py * half)} L ${n(cx - px * half)} ${n(cy - py * half)}`;
}

/** The board: grid x grid cells on the chart area's ground with a hairline
 *  grid, the snake as one rounded band head first, the head a disc with
 *  two eyes on the moving side, the food a round dot, and each candidate
 *  move as a chevron in the cell it leads to. A move into a wall has no
 *  cell to draw in, so it is a bar along that edge instead: it reads as
 *  the wall it is, and nothing is ever painted outside the board. */
function Board({
  grid,
  snake,
  food,
  heading,
  arrows,
  onPick,
}: {
  grid: number;
  snake: SnakeCell[];
  food: SnakeCell | null;
  heading: SnakeHeading;
  arrows: Arrow[];
  onPick?: (n: number, option?: SnakeAction) => void;
}) {
  const side = grid * CELL;
  const centre = (c: SnakeCell) => [(c.x + 0.5) * CELL, (c.y + 0.5) * CELL] as const;
  const cells = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) out.push([x, y]);
    return out;
  }, [grid]);
  const head = snake[0] ?? null;
  const [hx, hy] = head ? centre(head) : [0, 0];
  const off = CELL * 0.16;
  const sidew = CELL * 0.14;
  /* Relative to the head's own centre: the head is a group the board slides
     to its new cell, and the eyes ride it. */
  const eyes: Array<[number, number]> = !head
    ? []
    : heading === 'up'
      ? [
          [-sidew, -off],
          [sidew, -off],
        ]
      : heading === 'down'
        ? [
            [-sidew, off],
            [sidew, off],
          ]
        : heading === 'left'
          ? [
              [-off, -sidew],
              [-off, sidew],
            ]
          : [
              [off, -sidew],
              [off, sidew],
            ];
  /* Each mark: a chevron in the cell its direction leads to, or, when that
     cell is off the grid, a bar along the wall it would hit. */
  const drawnArrows = !head
    ? []
    : arrows.map(arrow => {
        const [dx, dy] = DELTA[arrow.direction];
        const ahead = { x: head.x + dx, y: head.y + dy };
        const wall = ahead.x < 0 || ahead.y < 0 || ahead.x >= grid || ahead.y >= grid;
        if (wall) return { arrow, wall, points: wallBar(hx, hy, arrow.direction) };
        void ahead;
        return { arrow, wall, points: arrowPath(hx, hy, arrow.direction) };
      });
  return (
    <svg
      className="snake-board"
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      data-motion={reducedMotion() ? 'reduce' : 'animate'}
      aria-label={`Snake board, ${grid} by ${grid}`}
    >
      <title>Snake board</title>
      <rect className="snake-bg" x={0} y={0} width={side} height={side} />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} className="snake-cell" x={x * CELL} y={y * CELL} width={CELL} height={CELL} />
      ))}
      {food && <circle className="snake-food" cx={centre(food)[0]} cy={centre(food)[1]} r={CELL * 0.3} />}
      {snake.length > 0 && (
        <path
          className="snake-snake"
          d={bandPath(snake.map(centre))}
          fill="none"
          strokeWidth={CELL * 0.72}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {head && (
        <g className="snake-head-mark" style={{ transform: `translate(${hx}px, ${hy}px)` }}>
          <circle className="snake-head" cx={0} cy={0} r={CELL * 0.36} />
          {eyes.map(([ex, ey], i) => (
            <circle key={i} className="snake-eye" cx={ex} cy={ey} r={CELL * 0.07} />
          ))}
        </g>
      )}
      {drawnArrows.map(({ arrow, wall, points }) => {
        const key = arrow.action ?? arrow.direction;
        const mark = (
          <>
            <path
              className={`snake-arrow ${arrow.decided ? 'is-decided' : 'is-open'}${wall ? ' is-wall' : ''}`}
              data-direction={arrow.direction}
              data-action={arrow.action}
              d={points}
              fill="none"
              style={{ strokeOpacity: arrow.opacity }}
              strokeWidth={ARROW_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        );
        if (!arrow.href || arrow.number === undefined) return <g key={key}>{mark}</g>;
        /* A link to the action's proposal on this floor, opened in place;
           the wide invisible stroke is the hit area, a cell across. */
        return (
          <a
            key={key}
            className="snake-arrow-link"
            href={arrow.href}
            aria-label={`${arrow.action}: open its proposal #${arrow.number}`}
            onClick={e => {
              if (!onPick) return;
              e.preventDefault();
              onPick(arrow.number as number, arrow.action ?? undefined);
            }}
          >
            <path
              className="snake-arrow-hit"
              d={points}
              fill="none"
              stroke="transparent"
              strokeWidth={CELL * 0.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {mark}
          </a>
        );
      })}
    </svg>
  );
}

/** A game and an ENTRY index into its recording (0-based, /history's `from`). */
type Replay = { game: number; entry: number };

/** The replay line for one recorded entry: the move the market took. */
function replayLine(row: SnakeHistoryStep): string {
  if (row.action === null) return `Step ${row.step}: start`;
  const past = ACTION_PAST[row.action] ?? row.action;
  return row.undecided ? `Step ${row.step}: ${past} (default)` : `Step ${row.step}: ${past}`;
}

export function SnakeLive({
  slug,
  onPickProposal,
  onStep,
  onQuotes,
  onState,
}: {
  slug: string;
  /** A chevron was clicked: select that proposal on the floor (docs/ui-conventions.md, "The feed drives the floor"). */
  onPickProposal?: (number: number, option?: SnakeAction) => void;
  /** The feed's open step changed or its decision landed, reported as soon as the poll reads it, never for the first read. */
  onStep?: (s: { step: number; decided: boolean }) => void;
  /** Every read: the open step's 60-move quotes by proposal id, for the floor's
   *  prices (docs/ui-conventions.md, "The feed drives the floor"): each
   *  option's price and lead on the one proposal, or each pair's approved
   *  and declined on the older per-action shape. */
  onQuotes?: (quotes: FeedQuotes) => void;
  /** Every read, the whole state, for the stat row's attempt (docs/ui-conventions.md, "The stat row"). */
  onState?: (state: SnakeState) => void;
}) {
  const [state, setState] = useState<SnakeState | null>(null);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const onQuotesRef = useRef(onQuotes);
  onQuotesRef.current = onQuotes;
  const stepKeyRef = useRef<string | null>(null);

  /* Realtime: one read now, then every 2 seconds while the tab is visible. */
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    const tick = async () => {
      try {
        const s = await api.getLiveState(slug);
        if (stopped) return;
        setState(s);
        setFetchedAt(Date.now());
        setFailed(false);
        /* The feed drives the floor: a new step or a decision is reported
           up the moment it is read, so the page reloads at once instead of
           on its own slower poll. The first read sets the baseline. */
        const step = s.open?.step ?? null;
        const decided = s.next?.decided === true;
        const key = step === null ? null : `${step}:${decided}`;
        if (step !== null && stepKeyRef.current !== null && key !== null && key !== stepKeyRef.current) {
          onStepRef.current?.({ step, decided });
        }
        if (key !== null) stepKeyRef.current = key;
        if (onQuotesRef.current && s.open) {
          const out: FeedQuotes = {};
          const one = s.open.proposal?.id;
          if (one) {
            const options: Record<string, { price: number | null; lead: number | null }> = {};
            for (const a of ACTIONS) {
              const q = s.open.quotes?.[a]?.m60;
              if (q) options[a] = { price: q.price ?? null, lead: q.lead ?? null };
            }
            out[one] = { options };
          } else {
            for (const a of ACTIONS) {
              const id = s.open.proposals?.[a]?.id;
              const q = s.open.quotes?.[a]?.m60;
              if (id && q) out[id] = { approved: q.approved ?? null, declined: q.declined ?? null };
            }
          }
          onQuotesRef.current(out);
        }
        onStateRef.current?.(s);
      } catch {
        if (!stopped) setFailed(true);
      }
    };
    const start = () => {
      if (timer === null) timer = window.setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else {
        void tick();
        start();
      }
    };
    void tick();
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [slug]);

  /* The countdown ticks by the second between polls. */
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  /* Replay: the games newest first, a per-game cache of loaded entries by
     entry index, the recorded total per game, and the entry the scrubber
     sits on. Realtime while `replay` is null. */
  const [games, setGames] = useState<SnakeGame[]>([]);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 10>(1);
  const [totals, setTotals] = useState<Record<number, number>>({});
  const entriesRef = useRef<Map<number, Map<number, SnakeHistoryStep>>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const [, setLoaded] = useState(0);

  const entryOf = useCallback((game: number, entry: number) => entriesRef.current.get(game)?.get(entry) ?? null, []);

  const loadWindow = useCallback(
    (game: number, from: number) => {
      const key = `${game}:${from}`;
      if (loadingRef.current.has(key)) return;
      loadingRef.current.add(key);
      api
        .getLiveHistory(slug, { game, from, limit: WINDOW })
        .then(h => {
          let map = entriesRef.current.get(game);
          if (!map) {
            map = new Map();
            entriesRef.current.set(game, map);
          }
          // Entries are kept by their index in the recording, `from + i`,
          // never by the move number they record.
          h.steps.forEach((s, i) => map.set(h.from + i, s));
          setTotals(t => (t[game] === h.total ? t : { ...t, [game]: h.total }));
          setLoaded(n => n + 1);
        })
        .catch(() => {
          /* A window that fails to load leaves the last drawn entry on screen. */
        })
        .finally(() => loadingRef.current.delete(key));
    },
    [slug],
  );

  /* The games list, and with it the newest game's first window, so the
     scrubber has a real range before anyone touches it. */
  useEffect(() => {
    let stopped = false;
    api
      .getLiveGames(slug)
      .then(r => {
        if (stopped) return;
        const sorted = [...r.games].sort((a, b) => b.number - a.number);
        setGames(sorted);
        if (sorted[0]) loadWindow(sorted[0].number, 0);
      })
      .catch(() => {
        /* No record yet: the replay row stays empty. */
      });
    return () => {
      stopped = true;
    };
  }, [slug, loadWindow]);

  /** The entry's row, fetching the window around it when it is not loaded. */
  const ensureLoaded = useCallback(
    (game: number, entry: number) => {
      if (entryOf(game, entry)) return;
      loadWindow(game, Math.max(0, entry - WINDOW / 2));
    },
    [entryOf, loadWindow],
  );

  /** Recorded entries of a game, or null until its first window is in. */
  const totalOf = useCallback((game: number): number | null => totals[game] ?? null, [totals]);

  const goTo = useCallback(
    (game: number, entry: number) => {
      const total = totalOf(game);
      const max = total === null ? Number.POSITIVE_INFINITY : Math.max(0, total - 1);
      const e = Math.min(Math.max(0, entry), max);
      setReplay({ game, entry: e });
      ensureLoaded(game, e);
    },
    [totalOf, ensureLoaded],
  );

  /* Play: one entry per tick at the chosen speed, held at the last entry. */
  useEffect(() => {
    if (!playing || !replay) return;
    const t = window.setInterval(() => {
      setReplay(cur => {
        if (!cur) return cur;
        const total = totalOf(cur.game);
        if (total === null) return cur;
        const max = Math.max(0, total - 1);
        if (cur.entry >= max) {
          setPlaying(false);
          return cur;
        }
        const next = cur.entry + 1;
        ensureLoaded(cur.game, next);
        // Look ahead so the next window is in before the scrubber reaches it.
        const ahead = next + 20;
        if (ahead <= max && !entryOf(cur.game, ahead)) loadWindow(cur.game, next + 1);
        return { game: cur.game, entry: next };
      });
    }, 1_000 / speed);
    return () => window.clearInterval(t);
  }, [playing, speed, replay, totalOf, ensureLoaded, entryOf, loadWindow]);

  const goLive = () => {
    setPlaying(false);
    setReplay(null);
  };

  const row = replay ? entryOf(replay.game, replay.entry) : null;
  const game = state?.game ?? null;
  const grid = replay
    ? (games.find(g => g.number === replay.game)?.size ?? state?.grid ?? 12)
    : (state?.grid ?? game?.size ?? 12);

  /* What the board draws: the live game, or the scrubbed entry. */
  const next = state?.next ?? null;
  /* The chevrons (docs/ui-conventions.md, "The snake feed", the grid): in
     replay the entry's own direction, solid; live, one per open action
     shaded by impact and linked to its proposal, the approved one alone
     once decided, and the leader's `next.direction` (the heading itself
     when unreadable, forward being the default) while no step is open. */
  const isHeading = (d: unknown): d is SnakeHeading => HEADINGS.includes(d as SnakeHeading);
  const liveArrows = (): Arrow[] => {
    if (!game) return [];
    const open = state?.open ?? null;
    if (open && next?.decided && isHeading(next.direction)) {
      const number = numberFor(state, next.action);
      return [
        {
          direction: next.direction,
          decided: true,
          opacity: 1,
          action: next.action,
          ...(number !== null ? { number, href: `/${slug}/p/${number}?option=${next.action}` } : {}),
        },
      ];
    }
    if (open && !next?.decided) {
      const actions = ACTIONS.filter(a => isHeading(open.directions?.[a]));
      if (actions.length > 0) {
        const numbers = actions.map(a => (state ? impactOf(state, a) : null));
        const opacities = isOneProposal(state) ? leadOpacities(numbers) : arrowOpacities(numbers);
        return actions.map((a, i) => {
          const number = numberFor(state, a);
          return {
            direction: open.directions[a],
            decided: false,
            opacity: opacities[i],
            action: a,
            ...(number !== null ? { number, href: `/${slug}/p/${number}?option=${a}` } : {}),
          };
        });
      }
    }
    return [
      {
        direction: next && isHeading(next.direction) ? next.direction : game.heading,
        decided: next?.decided === true,
        opacity: next?.decided === true ? 1 : 0.55,
      },
    ];
  };
  const drawn = replay
    ? row
      ? {
          snake: row.snake,
          food: row.food,
          heading: row.heading,
          arrows: [
            { direction: isHeading(row.direction) ? row.direction : row.heading, decided: true, opacity: 1 } as Arrow,
          ],
        }
      : null
    : game
      ? { snake: game.snake, food: game.food, heading: game.heading, arrows: liveArrows() }
      : null;

  const elapsed = fetchedAt ? Math.max(0, (now - fetchedAt) / 1000) : 0;
  const seconds = next ? Math.max(0, next.seconds - elapsed) : 0;
  /* A step whose countdown has run out stays run out until the next one
     opens: the service's own `seconds` came back 2, 1, 0, 1 across a
     boundary, and a line that takes "deciding" back for a second reads as a
     stutter where the page should be showing the transition. */
  const decidedStepRef = useRef<number | null>(null);
  const openStep = state?.open?.step ?? null;
  if (next && seconds < 1 && openStep !== null) decidedStepRef.current = openStep;
  const ranOut = !!next && (seconds < 1 || (openStep !== null && decidedStepRef.current === openStep));

  /* The 60-move impacts: carried on the drawing, shown only as the chevrons' shading. */
  const impacts = state ? ACTIONS.map(a => impactOf(state, a)) : [];
  const impactsAttr = impacts.length
    ? impacts.map(v => (v === null ? '' : String(Number(v.toFixed(1))))).join(',')
    : undefined;

  /* The scrubber's game: the one being replayed, else the newest. */
  const scrubGame = replay?.game ?? games[0]?.number;
  const scrubTotal = scrubGame === undefined ? null : totalOf(scrubGame);
  const scrubMax = scrubTotal === null ? 0 : Math.max(0, scrubTotal - 1);
  const scrubValue = replay ? Math.min(replay.entry, scrubMax) : scrubMax;

  /* The one line under the grid. */
  let line: { text: string; clock?: string; cls: string };
  if (replay) {
    line = { text: row ? replayLine(row) : `Game ${replay.game}`, cls: 'is-replay' };
  } else if (!state) {
    line = { text: failed ? 'Feed unavailable' : 'Loading', cls: 'is-idle' };
  } else if (!game) {
    line = { text: failed ? 'Feed unavailable' : 'Waiting for the next game', cls: 'is-idle' };
  } else if (!next || !(next.action in ACTION_WORDS)) {
    line = { text: 'Next move: continue forward (default)', cls: 'is-default' };
  } else if (next.decided) {
    line = { text: `Next move: ${ACTION_WORDS[next.action]}, decided`, cls: 'is-decided' };
  } else if (elapsed > STALE_S) {
    /* A feed read older than 8 seconds is said instead of a countdown the
       page cannot see (docs/ui-conventions.md, "The feed drives the floor"). */
    line = { text: `Next move: ${ACTION_WORDS[next.action]} · feed ${Math.round(elapsed)}s old`, cls: 'is-idle' };
  } else if (ranOut) {
    /* The countdown ran out (2026-09-11): the ruling lands a moment later
       and the next step a moment after that, and a line sitting on "in
       0:00" for those ten seconds hides the one transition the page exists
       to show. Under a second, so the clock never prints 0:00 at all; after the
       stale check, because a page that cannot see the feed does not know
       that anything is being decided. */
    line = { text: `Next move: ${ACTION_WORDS[next.action]}, deciding`, cls: 'is-decided' };
  } else {
    line = { text: `Next move: ${ACTION_WORDS[next.action]} in `, clock: clock(seconds), cls: 'is-open' };
  }

  return (
    <div className="snake-live">
      <div className="snake-main" data-impacts={impactsAttr}>
        <div className="snake-board-box">
          {drawn ? (
            <Board
              grid={grid}
              snake={drawn.snake}
              food={drawn.food}
              heading={drawn.heading}
              arrows={drawn.arrows}
              onPick={onPickProposal}
            />
          ) : (
            <Board grid={grid} snake={[]} food={null} heading="right" arrows={[]} />
          )}
        </div>
        <p className={`snake-next ${line.cls}`}>
          {line.text}
          {line.clock !== undefined && <span className="snake-clock">{line.clock}</span>}
        </p>
      </div>
      <div className="snake-replay" role="group" aria-label="Replay">
        <select
          className="snake-games"
          aria-label="Game"
          value={replay?.game ?? ''}
          onChange={e => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && e.target.value !== '') {
              setPlaying(false);
              goTo(n, 0);
            }
          }}
        >
          {replay === null && <option value="">Replay a game</option>}
          {games.map(g => (
            <option key={g.number} value={g.number}>
              {`Game ${g.number} · ${g.size}x${g.size} · best ${g.bestLength}`}
            </option>
          ))}
        </select>
        <input
          className="snake-scrub"
          type="range"
          aria-label="Entry"
          min={0}
          max={scrubMax}
          value={scrubValue}
          disabled={scrubTotal === null}
          style={{ '--slider-pct': `${scrubMax ? (scrubValue / scrubMax) * 100 : 0}%` } as React.CSSProperties}
          onChange={e => {
            if (scrubGame === undefined) return;
            setPlaying(false);
            goTo(scrubGame, Number(e.target.value));
          }}
        />
        <button
          type="button"
          className="mchart-range snake-btn"
          disabled={scrubTotal === null}
          onClick={() => {
            if (!replay) {
              if (scrubGame === undefined) return;
              goTo(scrubGame, 0);
            }
            setPlaying(p => !p);
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="mchart-range snake-btn" onClick={() => setSpeed(s => (s === 1 ? 10 : 1))}>
          {`${speed}x`}
        </button>
        <button
          type="button"
          className={`mchart-range snake-btn snake-live-btn${replay === null ? ' is-active' : ''}`}
          aria-pressed={replay === null}
          onClick={goLive}
        >
          Live
        </button>
      </div>
    </div>
  );
}
