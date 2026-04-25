export const FEEDBACK_KINDS = ['bug', 'help', 'feedback'] as const;
export const FEEDBACK_STATUSES = ['open', 'triaged', 'resolved', 'closed'] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_LIMITS = {
  subject: 200,
  body: 10_000,
  url: 2_000,
  userAgent: 500,
  email: 320,
  notes: 20_000,
} as const;

export function isValidFeedbackKind(v: unknown): v is FeedbackKind {
  return typeof v === 'string' && (FEEDBACK_KINDS as readonly string[]).includes(v);
}

export function isValidFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(v);
}

export function trimWithLimit(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}
