import { api } from './api';

/**
 * Where a trader lands by default (trader-first flip, 2026-08-08): straight
 * onto the trading floor when there is exactly one public workspace (the
 * flagship phase), else the marketplace list. Kept as a fetch rather than a
 * hardcoded slug so nothing breaks when the second workspace opens.
 */
export async function tradeHome(): Promise<string> {
  try {
    const rows = (await api.getPublicWorkspaces()) as Array<{ slug?: string | null }>;
    if (rows.length === 1 && rows[0].slug) return `/${rows[0].slug}`;
  } catch (e) {
    console.error('tradeHome fetch failed:', e);
  }
  return '/marketplace';
}
