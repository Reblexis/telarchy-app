import { indexBundleSrc } from './bundle-version';

/**
 * A tab that is already open picks the new build up.
 *
 * Publishing swaps the revision; a browser that already has the app loaded
 * keeps running the bundle it downloaded, because nothing on the wire tells
 * it to stop. HTTP caching is not the gap - index.html is `no-cache` with an
 * ETag and every hashed asset is `immutable`, so any fresh navigation gets
 * the new build. The gap is the case with no navigation in it: a phone tab
 * restored from memory hours later, its timers frozen the whole time.
 *
 *   tab becomes visible ─▶ compare the served entry bundle with the running one
 *   (or bfcache restore)      │
 *   or 5 min while visible    ├─ same ──▶ nothing
 *                             └─ new build
 *                                   ├─ back from ≥1 min away, nothing typed
 *                                   │      ──▶ reload (once a minute at most)
 *                                   └─ otherwise ──▶ offer the pill
 *
 * Spec: docs/infra/deploy.md, "A tab that is already open picks the new build
 * up". The other half of the same staleness is src/lib/lazy-page.tsx, which
 * catches a route chunk that a deploy rotated away.
 */

/** One automatic reload per minute per tab, remembered across the reload. */
export const RELOAD_GUARD_KEY = 'build-reload-at';

const CHECK_INTERVAL_MS = 300_000;
/** Away this long, and coming back is a moment where a reload costs nothing. */
const AWAY_MS = 60_000;
const RELOAD_GUARD_MS = 60_000;

/** The entry bundle this document loaded, or null on a dev-served page. */
export function runningBundlePath(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.getAttribute('src');
  if (!src) return null;
  return new URL(src, window.location.origin).pathname;
}

/** Compare hashed file names, never paths: the same build is served at
 *  `/assets/...` and, on the beta, at `/beta/assets/...`. */
function bundleName(path: string | null): string | null {
  return path?.match(/index-[\w-]+\.js/)?.[0] ?? null;
}

const NOT_TYPED = new Set(['hidden', 'checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'range', 'color']);

/** Whether the page holds something a visitor typed and would lose. */
export function pageHasTypedText(): boolean {
  const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
  for (const field of fields) {
    if (field instanceof HTMLInputElement && NOT_TYPED.has((field.type || 'text').toLowerCase())) continue;
    if (field.value.trim() !== '') return true;
  }
  const editable = Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"], [contenteditable=""]'));
  return editable.some(el => (el.textContent ?? '').trim() !== '');
}

function takeReloadSlot(guardMs: number): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0) || 0;
  } catch {
    /* storage off: the guard is a nicety, the update is not */
  }
  if (Date.now() - last < guardMs) return false;
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    /* storage off */
  }
  return true;
}

export type BuildWatchOptions = {
  /** The bundle the tab is running; null (dev) keeps the watch inert. */
  runningBundle: string | null;
  fetchIndexHtml: () => Promise<string>;
  /** A new build the visitor should be offered rather than given. */
  onUpdate: () => void;
  reload: () => void;
  hasTypedText?: () => boolean;
  intervalMs?: number;
  awayMs?: number;
  reloadGuardMs?: number;
};

/** Start watching; the returned function detaches everything. */
export function startBuildWatch(options: BuildWatchOptions): () => void {
  const running = bundleName(options.runningBundle);
  if (!running) return () => {};

  const intervalMs = options.intervalMs ?? CHECK_INTERVAL_MS;
  const awayMs = options.awayMs ?? AWAY_MS;
  const guardMs = options.reloadGuardMs ?? RELOAD_GUARD_MS;
  const hasTypedText = options.hasTypedText ?? pageHasTypedText;
  let hiddenAt = Date.now();
  let stopped = false;

  const check = (returning: boolean) => {
    options
      .fetchIndexHtml()
      .then(html => {
        if (stopped) return;
        const served = bundleName(indexBundleSrc(html));
        if (!served || served === running) return;
        // Text a visitor typed outranks a fresh build, always.
        if (returning && !hasTypedText() && takeReloadSlot(guardMs)) {
          options.reload();
          return;
        }
        options.onUpdate();
      })
      .catch(() => {
        /* offline, or a server mid-deploy: the tab keeps the build it has */
      });
  };

  const onVisibility = () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const away = Date.now() - hiddenAt;
    hiddenAt = Date.now();
    check(away >= awayMs);
  };
  // A bfcache restore is the phone case in its purest form: the tab comes
  // back whole, sometimes without a visibility change at all.
  const onPageShow = (e: PageTransitionEvent) => check(e.persisted === true);
  const tick = () => {
    if (!document.hidden) check(false);
  };

  const interval = setInterval(tick, intervalMs);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    stopped = true;
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
  };
}
