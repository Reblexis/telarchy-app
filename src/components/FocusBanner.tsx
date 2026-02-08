import type { Metric } from '../types';

interface FocusBannerProps {
  metric: Metric;
  onExit: () => void;
}

export function FocusBanner({ metric, onExit }: FocusBannerProps) {
  return (
    <div className="focus-banner">
      <div className="focus-banner-text">
        Focus Mode: <strong>{metric.name}</strong>
      </div>
      <button className="focus-exit-btn" onClick={onExit}>
        Exit Focus Mode
      </button>
    </div>
  );
}
