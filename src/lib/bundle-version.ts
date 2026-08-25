/**
 * The built entry bundle a served index.html references, as a root-relative
 * path, or null when there is none (the dev server injects the source entry
 * instead of a built bundle, which is what keeps the stale-tab guard inert
 * in dev). Used by the floor to notice that a deploy happened while the tab
 * stayed open (owner report 2026-08-13: a fixed bug kept "happening" in a
 * tab still running the pre-fix bundle).
 */
export function indexBundleSrc(html: string): string | null {
  const m = html.match(/\/assets\/index-[\w-]+\.js/);
  return m ? m[0] : null;
}
