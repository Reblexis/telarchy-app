export function ProbabilitySlider({ probability, rangeMin, rangeMax, previewProb }: {
  probability: number; rangeMin: number; rangeMax: number; previewProb?: number;
}) {
  const pct = probability * 100;
  const prevPct = previewProb !== undefined ? previewProb * 100 : undefined;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '120px' }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: '28px', textAlign: 'right' }}>{rangeMin}</span>
      <div style={{ flex: 1, height: '8px', background: 'var(--border-color)', borderRadius: '4px', position: 'relative' }}>
        {prevPct !== undefined && (
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${prevPct}%`, background: 'var(--accent-color, #3b82f6)', borderRadius: '4px', opacity: 0.25 }} />
        )}
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: 'var(--accent-color, #3b82f6)', borderRadius: '4px' }} />
        <div style={{ position: 'absolute', left: `${pct}%`, top: '-3px', width: '3px', height: '14px', background: 'var(--text-color)', borderRadius: '2px', transform: 'translateX(-50%)' }} />
        {prevPct !== undefined && prevPct !== pct && (
          <div style={{ position: 'absolute', left: `${prevPct}%`, top: '-3px', width: '2px', height: '14px', background: 'var(--accent-color, #3b82f6)', borderRadius: '2px', transform: 'translateX(-50%)', opacity: 0.6 }} />
        )}
      </div>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: '28px' }}>{rangeMax}</span>
    </div>
  );
}
