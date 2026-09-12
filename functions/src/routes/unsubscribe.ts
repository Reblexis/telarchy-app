import { Router } from 'express';
import { db } from '../db/client';
import { emailOptOuts } from '../db/schema';
import { AppError } from '../lib/errors';
import { emailFromToken } from '../lib/unsubscribe';
import { wrap } from '../lib/wrap';

/**
 * Stopping announcements (docs/announcements-by-email.md, "Unsubscribing").
 *
 * No session anywhere here. The token in the link is an address and a keyed
 * signature of it, and that is the whole credential, because the people a
 * broadcast reaches may hold no account at all. A token that does not verify
 * unsubscribes nobody.
 */

const SUPPORT = process.env.SUPPORT_EMAIL || 'support@telarchy.com';

export const unsubscribeRouter = Router();

/** Both verbs do the same thing; POST is the one-click standard's. */
async function unsubscribe(token: string, source: string): Promise<string | null> {
  const email = emailFromToken(token);
  if (!email) return null;
  await db.insert(emailOptOuts).values({ email, source, at: new Date() }).onConflictDoNothing();
  return email;
}

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>Telarchy</title>` +
  `<body style="margin:0;font:16px/1.5 system-ui,sans-serif;color:#111;background:#fff">` +
  `<main style="max-width:34rem;margin:12vh auto;padding:0 1.25rem">${message}</main>`;

unsubscribeRouter.post(
  '/:token',
  wrap(async (req, res) => {
    const email = await unsubscribe(String(req.params.token), 'one-click');
    if (!email) throw new AppError('That unsubscribe link is not valid', 400);
    res.status(200).end();
  }),
);

unsubscribeRouter.get(
  '/:token',
  wrap(async (req, res) => {
    const email = await unsubscribe(String(req.params.token), 'link');
    if (!email) {
      res
        .status(400)
        .type('html')
        .send(
          PAGE(
            '<h1 style="font-size:1.4rem;margin:0 0 .5rem">That link is not valid</h1>' +
              `<p>Nothing was changed. Write to <a href="mailto:${SUPPORT}">${SUPPORT}</a> and we will stop the mail by hand.</p>`,
          ),
        );
      return;
    }
    res
      .status(200)
      .type('html')
      .send(
        PAGE(
          '<h1 style="font-size:1.4rem;margin:0 0 .5rem">Unsubscribed</h1>' +
            `<p><strong>${email}</strong> will receive no more announcements from Telarchy.</p>` +
            '<p style="color:#555">Notifications about your own markets and proposals are separate, and you can turn those off in your account settings.</p>',
        ),
      );
  }),
);
