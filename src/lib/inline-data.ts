/**
 * The payload the server planted in the HTML it served (docs/ui-conventions.md,
 * "While a page loads"): a <script id="telarchy-*" type="application/json">
 * carrying what the page needs for its first paint, so a full document load
 * paints with data instead of with ghosts.
 *
 * The page reads it once on mount and drops the element, so a client-side
 * return to the same route fetches instead of painting a stale copy. A
 * payload older than five minutes (a tab restored from the back-forward
 * cache) is treated as absent for the same reason.
 */

const MAX_AGE_MS = 5 * 60_000;

export function readInline<T>(id: string): T | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(id);
  if (!el || el.tagName !== 'SCRIPT' || (el as HTMLScriptElement).type !== 'application/json') return null;
  try {
    const parsed = JSON.parse(el.textContent ?? '') as T & { at?: unknown };
    if (parsed && typeof parsed === 'object' && typeof parsed.at === 'string') {
      const at = Date.parse(parsed.at);
      if (Number.isFinite(at) && Date.now() - at > MAX_AGE_MS) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function dropInline(id: string): void {
  if (typeof document === 'undefined') return;
  document.getElementById(id)?.remove();
}
