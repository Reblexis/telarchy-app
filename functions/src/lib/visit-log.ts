/**
 * Which document loads belong in the visitor log.
 *
 * The log answers one question for the owner: did a stranger show up. A
 * path that only the owner can open is not a stranger showing up, so it is
 * not recorded at all rather than filtered on read: counting it would put
 * the owner's own reading into visits, uniques and the top-pages list, and
 * filtering it on read would move those hits into the "bot hits" bucket,
 * which is a different lie. See docs/ui-conventions.md, "The cockpit".
 */
const OPERATOR_PATHS = ['/admin'];

export function shouldLogVisit(path: string): boolean {
  return !OPERATOR_PATHS.some(p => path === p || path.startsWith(`${p}/`));
}
