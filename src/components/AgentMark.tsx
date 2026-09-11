/** A small machine with a signal path, in the site's own line-drawing language. */
export function AgentMark({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      className={compact ? 'agent-mark agent-mark--small' : 'agent-mark'}
      viewBox="0 0 160 140"
      fill="none"
      aria-hidden="true"
    >
      {!compact && (
        <>
          <circle className="agent-mark-orbit" cx="80" cy="70" r="62" />
          <path className="agent-mark-orbit" d="M5 70h27m96 0h27M80 0v25m0 90v25" />
          <circle cx="136" cy="43" r="4" fill="var(--accent)" />
        </>
      )}
      <path d="M80 29v14" stroke="currentColor" strokeWidth="2" />
      <circle cx="80" cy="25" r="4" fill="var(--accent)" />
      <rect
        x="39"
        y="44"
        width="82"
        height="62"
        rx="22"
        fill="var(--bg-primary)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M31 65v20m98-20v20M64 88h32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="58" y="62" width="10" height="12" rx="5" fill="currentColor" />
      <rect x="92" y="62" width="10" height="12" rx="5" fill="currentColor" />
    </svg>
  );
}
