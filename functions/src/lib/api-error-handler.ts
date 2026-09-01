import type { NextFunction, Request, Response } from 'express';
import { docUrlFor } from './error-codes';
import { AppError } from './errors';

/**
 * The API's one error handler, in its own module so its masking rule has a
 * test: the help catalog promises a readable 501 on
 * /api/admin/branches/build, and an earlier inline version swallowed exactly
 * that message.
 */
export function apiErrorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error(err);
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  // AppError messages are caller-facing by construction, whatever their
  // status: a deliberate 501 ("no GITHUB_ACTIONS_TOKEN, run gh workflow run
  // ... by hand") exists to be read, and masking it cost a session of
  // guessing (owner report 2026-08-28). Only an UNEXPECTED 5xx can carry
  // driver / internal detail (Postgres text, stack context), so only those
  // get the generic string; the real error is already logged above.
  const message = err instanceof AppError ? err.message : 'Internal error';
  // The machine-readable half, when the error has one. Omitted entirely rather
  // than sent as null: `"code": null` reads like a code the caller failed to
  // recognise, when it means the error simply has not been given one yet.
  const code = err instanceof AppError ? err.code : undefined;
  res.status(status).json({
    error: message,
    ...extra,
    ...(code ? { code, doc_url: docUrlFor(code) } : {}),
  });
}
