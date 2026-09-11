/**
 * The line-drawn robot: the top bar's Agents link and the mark beside every
 * bot's name (docs/ui-conventions.md, "A bot says it is one") draw this one
 * glyph, so a reader who knows one knows the other.
 */
export function BotGlyph({ size = 22, strokeWidth = 1.6 }: { size?: number | string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="7" width="16" height="13" rx="4" />
      <path d="M12 3v4M1 12v4m22-4v4M8 16h8" />
      <circle cx="8" cy="12" r=".8" />
      <circle cx="16" cy="12" r=".8" />
    </svg>
  );
}
