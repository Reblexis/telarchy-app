/**
 * Manifold Markets' actual logomark (fetched from manifold.markets/logo.svg,
 * 2026-08-11): the origami-crane path, stroked. Brand indigo by default;
 * pass color="currentColor" where it should follow the surrounding text.
 * stroke-width is bumped from the source's 0.6 so it reads at small sizes.
 */
export function ManifoldLogo({
  size = 18,
  color = '#4337C9',
  strokeWidth = 1.4,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true" style={{ display: 'block' }}>
      <path
        d="M5.24854 17.0952L18.7175 6.80301L14.3444 20M5.24854 17.0952L9.79649 18.5476M5.24854 17.0952L4.27398 6.52755M14.3444 20L9.79649 18.5476M14.3444 20L22 12.638L16.3935 13.8147M9.79649 18.5476L12.3953 15.0668M4.27398 6.52755L10.0714 13.389M4.27398 6.52755L2 9.0818L4.47389 8.85643M12.9451 11.1603L10.971 5L8.65369 11.6611"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
