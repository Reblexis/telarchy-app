import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';

export function HookStatus() {
  const [status, setStatus] = useState<{ active: boolean; lastPolledAt?: string; intervalMs?: number } | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [secsAgo, setSecsAgo] = useState(0);
  const lastPolledRef = useRef<number>(0);

  useEffect(() => {
    api.getHooksStatus().then(s => {
      setStatus(s);
      if (s.lastPolledAt) lastPolledRef.current = new Date(s.lastPolledAt).getTime();
    }).catch((e: Error) => { console.error('HookStatus fetch failed:', e.message); setFetchError(true); });
  }, []);

  useEffect(() => {
    if (!status?.active) return;
    const id = setInterval(() => {
      setSecsAgo(Math.floor((Date.now() - lastPolledRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status?.active]);

  if (fetchError) return null;
  if (!status || !status.active) return null;

  const intervalSecs = (status.intervalMs || 60000) / 1000;
  const remaining = Math.max(0, intervalSecs - secsAgo);

  return (
    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: 'var(--success-text)',
        display: 'inline-block',
        animation: 'pulse 2s infinite',
      }} />
      Hooks: {remaining}s
    </span>
  );
}
