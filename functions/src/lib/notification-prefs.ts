/**
 * The notification matrix (owner ask 2026-08-24: "there should be web mobile
 * and email", per kind, like Manifold's settings). The proposal is
 * docs/vision.md, "Participant notifications".
 *
 * One KIND is one thing that can happen to you; one CHANNEL is one way of
 * hearing about it. Web is the bell inbox, email is mail, mobile is a browser
 * push notification. Every (kind, channel) cell is a switch.
 *
 * Storage is split by channel on purpose, so each cell has exactly one owner:
 *
 * - EMAIL cells live on the six legacy boolean columns of `agents`
 *   (notify_comment_on_my_proposal and friends). They predate the matrix,
 *   every mail path already reads them, and moving them would be a rewrite
 *   with no behaviour change.
 * - WEB and MOBILE cells live in `agents.notification_channels`, a jsonb of
 *   OVERRIDES: `{ [kind]: { web?: boolean, mobile?: boolean } }`. A missing
 *   cell means its default, so the column stays empty for everyone who never
 *   touched the settings and a new kind needs no backfill.
 *
 * The proposer's decision email stays outside the matrix entirely: a decision
 * on a proposal YOU POSTED always mails (owner ask 2026-08-19), whatever the
 * `decision` row says. The `decision` kind governs everyone else.
 */

export const NOTIFICATION_KINDS = ['comment', 'reply', 'contract', 'anyComment', 'settled', 'decision'] as const;
export type NotificationKindId = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_CHANNELS = ['web', 'email', 'mobile'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** What each kind means, one sentence, shared by /api/help and the dialog. */

/**
 * The defaults are the design (docs/vision.md): personal kinds, the answers
 * to your own activity, are on everywhere; the firehoses (new proposals,
 * every comment), whose volume is set by strangers, are off except that the
 * bell has always shown new proposals and keeps doing so.
 */
export const CHANNEL_DEFAULTS: Record<NotificationKindId, Record<NotificationChannel, boolean>> = {
  comment: { web: true, email: true, mobile: true },
  reply: { web: true, email: true, mobile: true },
  contract: { web: true, email: false, mobile: false },
  anyComment: { web: false, email: false, mobile: false },
  settled: { web: true, email: true, mobile: true },
  decision: { web: true, email: true, mobile: true },
};

/** The legacy email column that owns each kind's email cell. */

/** The jsonb overrides, as stored. Unknown keys are ignored on read. */
export type ChannelOverrides = Partial<Record<NotificationKindId, { web?: boolean; mobile?: boolean }>>;

/** One resolved cell: the override when present, the default otherwise. */
export function channelOn(
  overrides: ChannelOverrides | null | undefined,
  kind: NotificationKindId,
  channel: 'web' | 'mobile',
): boolean {
  const v = overrides?.[kind]?.[channel];
  return typeof v === 'boolean' ? v : CHANNEL_DEFAULTS[kind][channel];
}

/** The full resolved matrix for one participant, email cells included, for
 *  GET /api/auth/me: the client renders exactly this and never re-derives. */
export function resolveMatrix(
  overrides: ChannelOverrides | null | undefined,
  emailFlags: Record<NotificationKindId, boolean>,
): Record<NotificationKindId, Record<NotificationChannel, boolean>> {
  const out = {} as Record<NotificationKindId, Record<NotificationChannel, boolean>>;
  for (const kind of NOTIFICATION_KINDS) {
    out[kind] = {
      web: channelOn(overrides, kind, 'web'),
      email: emailFlags[kind],
      mobile: channelOn(overrides, kind, 'mobile'),
    };
  }
  return out;
}

/**
 * Validate and merge a partial matrix update from POST /api/auth/profile.
 * Returns the new overrides object and the email columns to write, or an
 * error string. Every named cell must be a boolean; an unnamed cell keeps its
 * value, so the dialog can flip one toggle without re-sending the matrix.
 */
export function applyMatrixUpdate(
  current: ChannelOverrides | null | undefined,
  update: unknown,
): { overrides: ChannelOverrides; emailUpdates: Partial<Record<NotificationKindId, boolean>> } | { error: string } {
  if (update === null || typeof update !== 'object' || Array.isArray(update)) {
    return { error: 'notificationChannels must be an object of { kind: { web?, email?, mobile? } }' };
  }
  const overrides: ChannelOverrides = JSON.parse(JSON.stringify(current ?? {}));
  const emailUpdates: Partial<Record<NotificationKindId, boolean>> = {};
  for (const [kind, cells] of Object.entries(update as Record<string, unknown>)) {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) {
      return { error: `unknown notification kind "${kind}"` };
    }
    const k = kind as NotificationKindId;
    if (cells === null || typeof cells !== 'object' || Array.isArray(cells)) {
      return { error: `notificationChannels.${kind} must be an object` };
    }
    for (const [channel, value] of Object.entries(cells as Record<string, unknown>)) {
      if (!(NOTIFICATION_CHANNELS as readonly string[]).includes(channel)) {
        return { error: `unknown channel "${channel}" on notificationChannels.${kind}` };
      }
      if (typeof value !== 'boolean') {
        return { error: `notificationChannels.${kind}.${channel} must be true or false` };
      }
      if (channel === 'email') {
        emailUpdates[k] = value;
      } else {
        overrides[k] = { ...overrides[k], [channel]: value };
      }
    }
  }
  return { overrides, emailUpdates };
}
