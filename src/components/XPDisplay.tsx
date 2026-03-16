interface XPDisplayProps {
  xp: number | null;
  rank: string;
}

export function XPDisplay({ xp, rank }: XPDisplayProps) {
  return (
    <div className="xp-display">
      <div className="xp-circle">
        <div className="xp-value">{xp === null ? '—' : xp.toFixed(2)}</div>
        <div className="xp-label">XP</div>
      </div>
      <div className="rank-display">
        Rank: <span>{rank}</span>
      </div>
    </div>
  );
}
