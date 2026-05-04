import { useInspectMode } from '../hooks/useInspectMode';

export function InspectIndicator() {
  const { inspectProposal, setInspectProposal } = useInspectMode();
  if (!inspectProposal) return null;
  return (
    <span className="inspect-indicator" role="status">
      <span className="inspect-indicator-dot" aria-hidden="true" />
      Showing impact of <span className="inspect-indicator-title">{inspectProposal.title}</span>
      <button
        type="button"
        className="inspect-indicator-exit"
        onClick={() => setInspectProposal(null)}
        aria-label="Exit inspect mode"
      >
        ×
      </button>
    </span>
  );
}
