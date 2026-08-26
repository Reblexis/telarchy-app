/**
 * Payment-provider webhooks. Mounted BEFORE express.json() so the raw body
 * survives for signature verification; the policy lists /api/billing as
 * anonymous because the signature is the authentication.
 */

import express, { Router } from 'express';
import { AppError } from '../lib/errors';
import { handleStripeWebhook } from '../services/funding';

export const billingRouter = Router();

billingRouter.post('/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : '';
    const result = await handleStripeWebhook(raw, req.headers['stripe-signature'] as string | undefined);
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    console.error('[billing/stripe] webhook failed', e);
    res.status(500).json({ error: 'webhook failed' });
  }
});
