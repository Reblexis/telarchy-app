/** Cents to a dollar string, tabular: "$1,234.56". One definition. */
export function usd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 'YYYY-MM' to "September 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The floor path for a workspace: its slug, or the id under /marketplace. */
export function floorPath(ws: { slug: string | null; workspaceId: string }): string {
  return ws.slug ? `/${ws.slug}` : `/marketplace/${ws.workspaceId}`;
}
