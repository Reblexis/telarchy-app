/**
 * Which floor `/account` lands on: the instance's first public workspace, else
 * the floors list. The managed instance's first public workspace is LookPilot;
 * a self-hosted instance's is whatever it lists first (docs/vision.md,
 * "Self-hosting"). Nothing here names a workspace.
 */
export interface FloorListing {
  workspaceId?: string;
  slug?: string | null;
  workspaceSlug?: string | null;
}

export function pickDefaultFloor(listings: ReadonlyArray<FloorListing> | null | undefined): string {
  if (!listings || listings.length === 0) return '/floors';
  const first = listings[0];
  const slug = first.slug ?? first.workspaceSlug ?? null;
  if (slug && /^[a-z0-9-]+$/.test(slug)) return `/${slug}`;
  if (first.workspaceId) return `/marketplace/${first.workspaceId}`;
  return '/floors';
}
