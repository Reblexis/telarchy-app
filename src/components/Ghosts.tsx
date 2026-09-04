import type { CSSProperties } from 'react';

/**
 * Ghosts: grey bars in the exact shape of what is coming
 * (docs/ui-conventions.md, "While a page loads"). Drawn at the real
 * element's height and width in the real layout, so nothing moves when the
 * content lands. Never a dot, never a spinner, never text.
 */
export function Ghost({
  w,
  h,
  r,
  className,
  style,
}: {
  w: string | number;
  h: string | number;
  r?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={className ? `pubws-ghost ${className}` : 'pubws-ghost'}
      aria-hidden="true"
      style={{ width: w, height: h, borderRadius: r, ...style }}
    />
  );
}

/** A rail of list rows: a dot, a line, a figure. */
export function GhostRows({ n = 6 }: { n?: number }) {
  return (
    <div className="pubws-ghost-rows" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div className="pubws-ghost-row" key={i}>
          <Ghost w={18} h={18} r={9} />
          <Ghost w="60%" h={10} />
          <Ghost w={44} h={10} />
        </div>
      ))}
    </div>
  );
}

/** The one element assistive technology hears while the page is ghosts. */
export function LoadingStatus() {
  return <span className="pubws-ghost-status" role="status" aria-label="Loading" />;
}

/**
 * The page shell a lazily loaded route draws while its code downloads: the
 * site's one top bar (handed in, so this file never grows a second copy of
 * it) over an empty column.
 */
export function PageShell({ bar }: { bar: React.ReactNode }) {
  return (
    <div className="pubws">
      {bar}
      <main className="pubws-main">
        <Ghost w="60%" h={34} />
        <Ghost w="80%" h={12} style={{ marginTop: 18 }} />
        <Ghost w="70%" h={12} style={{ marginTop: 10 }} />
        <LoadingStatus />
      </main>
    </div>
  );
}
