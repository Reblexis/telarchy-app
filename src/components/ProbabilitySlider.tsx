export function ProbabilitySlider({ probability, rangeMin, rangeMax, previewProb, fullWidth }: {
  probability: number; rangeMin: number; rangeMax: number; previewProb?: number; fullWidth?: boolean;
}) {
  const pct = probability * 100;
  const prevPct = previewProb !== undefined ? previewProb * 100 : undefined;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: fullWidth ? '100%' : '120px', minWidth: fullWidth ? 0 : undefined }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: '28px', textAlign: 'right' }}>{rangeMin}</span>
      <div style={{ flex: 1, height: '8px', background: 'var(--border-color)', borderRadius: 'var(--radius-sm)', position: 'relative' }}>
        {prevPct !== undefined && (
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${prevPct}%`, background: 'var(--accent)', borderRadius: 'var(--radius-sm)', opacity: 0.25 }} />
        )}
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 'var(--radius-sm)' }} />
        <div style={{ position: 'absolute', left: `${pct}%`, top: '-3px', width: '3px', height: '14px', background: 'var(--text-color)', borderRadius: '4px', transform: 'translateX(-50%)' }} />
        {prevPct !== undefined && prevPct !== pct && (
          <div style={{ position: 'absolute', left: `${prevPct}%`, top: '-3px', width: '2px', height: '14px', background: 'var(--accent)', borderRadius: '4px', transform: 'translateX(-50%)', opacity: 0.6 }} />
        )}
      </div>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: '28px' }}>{rangeMax}</span>
    </div>
  );
}
