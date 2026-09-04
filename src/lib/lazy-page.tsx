import { Component, type ComponentType, lazy, type ReactNode, Suspense } from 'react';
import { PageShell } from '../components/Ghosts';
import { PageTopBar } from '../components/PageTopBar';

/**
 * Route-level code splitting with a self-healing failure path.
 *
 *   navigate ─▶ lazy chunk fetch ──ok──▶ page renders
 *                    │
 *                 fails (deploy rotated the hashed chunk away,
 *                        or the network is actually down)
 *                    ▼
 *          reloaded once already?  ──no──▶ location.reload()  (fresh HTML
 *                    │                     names fresh chunks; the visitor
 *                  yes                     sees one refresh, not a crash)
 *                    ▼
 *          quiet fallback + rethrow-free stop (no reload loop offline)
 *
 * Why this exists: the bundle used to be one 615 KB file, so every visitor
 * paid for the admin cockpit and the markdown renderer to see one market.
 * Splitting per route fixes that, but hashed chunk names die on every
 * Publish; a tab left open across a deploy would blank-screen on its first
 * navigation without the boundary (the standard Vite failure mode).
 */

/** Named-export pages: lazyPage(() => import('./pages/X'), 'XPage').
 *  Props pass through, so `<LegalPage document="terms" />` works lazily. */
export function lazyPage<K extends string, P extends object>(
  load: () => Promise<Record<K, ComponentType<P>>>,
  name: K,
) {
  // The cast collapses lazy()'s exotic-component type back to a plain
  // ComponentType<P>; the runtime shape is identical.
  const Inner = lazy(() => load().then(m => ({ default: m[name] }))) as unknown as ComponentType<P>;
  return function LazyRoute(props: P) {
    return (
      <ChunkBoundary>
        {/* Never nothing: the top bar over a ghost column, with the mark
            where the page will put it (docs/ui-conventions.md, "While a
            page loads"). A blank document for the length of the download
            was what /about showed before 2026-09-04. */}
        <Suspense fallback={<PageShell bar={<PageTopBar />} />}>
          <Inner {...props} />
        </Suspense>
      </ChunkBoundary>
    );
  };
}

const RELOADED_KEY = 'chunk-reload-at';

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /dynamically imported module|Loading chunk|Importing a module script failed/i.test(msg);
}

class ChunkBoundary extends Component<{ children: ReactNode }, { dead: boolean }> {
  state = { dead: false };

  static getDerivedStateFromError(): { dead: boolean } {
    return { dead: true };
  }

  componentDidCatch(err: unknown): void {
    if (!isChunkLoadError(err)) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0);
    } catch {
      /* storage off */
    }
    // One reload per minute: enough to heal a deploy, never a loop offline.
    if (Date.now() - last > 60_000) {
      try {
        sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
      } catch {
        /* storage off */
      }
      window.location.reload();
    }
  }

  render(): ReactNode {
    if (this.state.dead) {
      return (
        <div className="pubws-chunk-dead">
          This page failed to load. <a href={window.location.href}>Retry</a>
        </div>
      );
    }
    return this.props.children;
  }
}
