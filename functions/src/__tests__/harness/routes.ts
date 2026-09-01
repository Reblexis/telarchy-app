/**
 * Kept as the import path the route tests already use. The walk itself moved to
 * `lib/route-inventory.ts` when the deny-by-default policy started needing it
 * at runtime: "what routes exist" now decides whether an unrouted path answers
 * 404 or 401, so it cannot live in a test-only file that production disagrees
 * with.
 */
export { listApiRoutes, type RouteRef } from '../../lib/route-inventory';
