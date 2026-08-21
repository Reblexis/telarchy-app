/**
 * The ONE place the frontend knows what path it is mounted under.
 *
 * The app is built twice: at `/` for production and at `/beta/` for the
 * candidate preview (docs/infra/deploy.md). A root-absolute URL written
 * anywhere else silently walks a /beta visitor back onto the production
 * build, which is how "beta doesn't link to beta" shipped (owner report
 * 2026-08-21). The rules, enforced by
 * `lib/__tests__/internal-links-ownership.test.ts`:
 *
 *  - Internal navigation uses react-router `<Link>`/`navigate()`, which
 *    inherit the basename from this module via App.tsx. Never a raw anchor
 *    or a location assignment with a root-absolute literal.
 *  - The rare genuine URL (a server-rendered endpoint like /api/data-room,
 *    a fetch of the served index) goes through `withBase`.
 *  - `import.meta.env.BASE_URL` is read here and nowhere else.
 */

export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Prefix a root-absolute path with the build's mount point. */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}
