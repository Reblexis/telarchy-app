import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * The drawings the audience pages name (docs/audience-pages.md, "Pictures").
 *
 * A page says `VIZ: conditional-pair` in the markdown and gets the drawing
 * here; the build step refuses a name this file does not answer, so a doc
 * can never ship a page with a hole in it. They exist to spend fewer words:
 * /forecast argued its case in 1,160 of them, and a cold visitor decides in
 * five to ten seconds (`notes/yc-landing-explainer-2026-09-01.md`).
 *
 * Every one is the product's own vocabulary rather than illustration: the
 * step line, the conditional pair, the priced gap, the payoff rule the trade
 * ticket itself draws. Every colour is a token through a CSS class, never an
 * SVG attribute, so they follow the light and dark themes. They draw
 * themselves in on scroll and stand still for a reader who asked for less
 * motion; the drawing is complete either way, because it is information and
 * not an effect.
 */

/**
 * A drawing draws itself when it scrolls into view, and is COMPLETE at every
 * other moment: before the observer arms, without an observer at all, and for
 * a reader who has asked for less motion. The end state is the default in
 * CSS and the hidden state is added by this hook, so a drawing can never be
 * lost to an animation that did not run.
 */
function useDrawIn<T extends Element>(): [RefObject<T | null>, string] {
  const ref = useRef<T>(null);
  const [state, setState] = useState<'still' | 'pending' | 'in'>('still');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setState('pending');
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setState('in');
            io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return [ref, state === 'pending' ? ' is-pending' : state === 'in' ? ' is-in' : ''];
}

/** A dot field: a big venue's book against one of ours. */
function dots(count: number, cols: number, x0: number, y0: number, step: number, r: number, cls: string) {
  return Array.from({ length: count }, (_, i) => (
    <circle
      key={i}
      className={cls}
      cx={x0 + (i % cols) * step}
      cy={y0 + Math.floor(i / cols) * step}
      r={r}
      style={{ ['--i' as string]: String(i) }}
    />
  ));
}

/** Season 0's pool, split in proportion to how right each trader was. */
const SHARES = [
  0.93, 0.82, 0.74, 0.68, 0.61, 0.56, 0.5, 0.45, 0.41, 0.36, 0.32, 0.28, 0.24, 0.21, 0.17, 0.14, 0.11, 0.09, 0.07, 0.05,
  0.04, 0.02,
];

function ConditionalPair() {
  const [ref, cls] = useDrawIn<SVGSVGElement>();
  return (
    <svg
      ref={ref}
      className={`viz viz--pair${cls}`}
      viewBox="0 0 860 190"
      role="img"
      aria-label="One number, two futures, and the gap between them"
    >
      <path className="viz-line" d="M20,132 L110,132 L110,116 L200,116 L200,100 L290,100" />
      <circle className="viz-dot" cx="290" cy="100" r="6" />
      <text className="viz-num" x="20" y="118">
        $7,500/mo
      </text>
      <text className="viz-lab" x="20" y="158">
        a real company's revenue
      </text>
      <path className="viz-up" d="M290,100 C420,100 470,62 640,54" />
      <path className="viz-down" d="M290,100 C420,100 470,138 640,146" />
      <circle className="viz-dot viz-dot--up" cx="640" cy="54" r="6" />
      <circle className="viz-dot viz-dot--down" cx="640" cy="146" r="6" />
      <text className="viz-lab" x="352" y="44">
        if the job is approved
      </text>
      <text className="viz-lab" x="352" y="172">
        if it is declined
      </text>
      <path className="viz-gap" d="M672,54 L672,146" />
      <line className="viz-tick" x1="662" y1="54" x2="682" y2="54" />
      <line className="viz-tick" x1="662" y1="146" x2="682" y2="146" />
      <text className="viz-num" x="694" y="96">
        +$2,100
      </text>
      <text className="viz-lab" x="694" y="112">
        what the job is worth
      </text>
      <path className="viz-check" d="M694,132 L706,144 L734,116" />
      <text className="viz-lab" x="744" y="140">
        owner approves
      </text>
    </svg>
  );
}

function ThinBook() {
  const [ref, cls] = useDrawIn<SVGSVGElement>();
  return (
    <svg
      ref={ref}
      className={`viz viz--book${cls}`}
      viewBox="0 0 860 150"
      role="img"
      aria-label="Thousands of traders on one venue, four on ours"
    >
      <text className="viz-lab" x="20" y="18">
        a large venue, one election
      </text>
      {dots(156, 26, 24, 34, 15, 2.6, 'viz-many')}
      <text className="viz-lab" x="470" y="18">
        a Telarchy number, one week
      </text>
      {dots(4, 4, 486, 62, 34, 5, 'viz-few')}
      <text className="viz-num" x="20" y="140">
        thousands of traders
      </text>
      <text className="viz-num" x="470" y="140">
        4 trades
      </text>
    </svg>
  );
}

function PoolSplit() {
  const [ref, cls] = useDrawIn<SVGSVGElement>();
  const total = SHARES.reduce((a, b) => a + b, 0);
  let x = 20;
  return (
    <svg
      ref={ref}
      className={`viz viz--pool${cls}`}
      viewBox="0 0 860 130"
      role="img"
      aria-label="The season pool split among everyone who ended ahead"
    >
      <text className="viz-lab" x="20" y="18">
        the season pool, split in proportion to how right you were
      </text>
      {SHARES.map((s, i) => {
        const w = (820 * s) / total;
        const rect = (
          <rect
            key={s}
            className="viz-slice"
            x={x}
            y={34}
            width={Math.max(w - 2, 1.5)}
            height={34}
            rx={3}
            style={{ ['--i' as string]: String(i), opacity: 0.9 - i * 0.028 }}
          />
        );
        x += w;
        return rect;
      })}
      <text className="viz-lab" x="20" y="120">
        everyone above zero is paid, down to a minimum share
      </text>
    </svg>
  );
}

function PayoffLine() {
  const [ref, cls] = useDrawIn<SVGSVGElement>();
  return (
    <svg
      ref={ref}
      className={`viz viz--payoff${cls}`}
      viewBox="0 0 860 116"
      role="img"
      aria-label="What a bet is worth wherever the number settles"
    >
      <text className="viz-lab" x="20" y="16">
        what 200 credits are worth, wherever it settles
      </text>
      <text className="viz-cr viz-cr--down" x="20" y="44">
        -200 cr
      </text>
      <text className="viz-cr viz-cr--down" x="243" y="44" textAnchor="middle">
        -105 cr
      </text>
      <text className="viz-cr" x="580" y="44" textAnchor="middle">
        0 cr
      </text>
      <text className="viz-cr viz-cr--up" x="840" y="44" textAnchor="end">
        +86 cr
      </text>
      <rect className="viz-rule viz-rule--down" x="20" y="56" width="560" height="10" rx="5" />
      <rect className="viz-rule viz-rule--up" x="580" y="56" width="260" height="10" rx="5" />
      <text className="viz-lab" x="20" y="88">
        $0
      </text>
      <text className="viz-lab" x="243" y="88" textAnchor="middle">
        $8k
      </text>
      <text className="viz-lab" x="580" y="88" textAnchor="middle">
        $21k
      </text>
      <text className="viz-lab" x="840" y="88" textAnchor="end">
        $25k
      </text>
      <text className="viz-lab" x="580" y="106" textAnchor="middle">
        where it has to land for you to break even
      </text>
    </svg>
  );
}

export function AudienceViz({ name }: { name: string }) {
  switch (name) {
    case 'conditional-pair':
      return <ConditionalPair />;
    case 'thin-book':
      return <ThinBook />;
    case 'pool-split':
      return <PoolSplit />;
    case 'payoff-line':
      return <PayoffLine />;
    default:
      return null;
  }
}
