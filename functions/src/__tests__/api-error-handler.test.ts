/**
 * The API's one error handler: a deliberate AppError keeps its message at
 * EVERY status, and only an unexpected error is masked.
 *
 * The regression this pins (owner report 2026-08-28, "it says internal
 * error"): POST /api/admin/branches/build answers a deliberate 501 whose
 * message names the fix ("no GITHUB_ACTIONS_TOKEN ... gh workflow run
 * deploy-cloudrun.yml --ref <branch>"), and the handler masked every >=500
 * body into "Internal error", so the one string written to be read never
 * reached the person debugging it. The help catalog promises that message;
 * the mask broke the proposal.
 */

import type { NextFunction, Request, Response } from 'express';
import { apiErrorHandler } from '../lib/api-error-handler';
import { AppError } from '../lib/errors';

function respond(err: Error): { status: number; body: Record<string, unknown> } {
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    status(s: number) {
      status = s;
      return this;
    },
    json(b: Record<string, unknown>) {
      body = b;
    },
  } as unknown as Response;
  const noError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    apiErrorHandler(err, {} as Request, res, (() => {}) as NextFunction);
  } finally {
    noError.mockRestore();
  }
  return { status, body };
}

test('a deliberate 5xx AppError keeps its caller-facing message', () => {
  const { status, body } = respond(
    new AppError(
      'This instance has no GITHUB_ACTIONS_TOKEN, so it cannot ask CI to build a branch. From a terminal: gh workflow run deploy-cloudrun.yml --ref oss/lane-i',
      501,
    ),
  );
  expect(status).toBe(501);
  expect(body.error).toMatch(/gh workflow run deploy-cloudrun\.yml --ref oss\/lane-i/);
});

test('a 4xx AppError keeps its message and extra fields', () => {
  const { status, body } = respond(new AppError('Name a branch other than main', 400));
  expect(status).toBe(400);
  expect(body.error).toBe('Name a branch other than main');
});

test('an unexpected error is masked, because it can carry internals', () => {
  const { status, body } = respond(new Error('connect ECONNREFUSED 10.0.0.3:5432 (postgres said things)'));
  expect(status).toBe(500);
  expect(body.error).toBe('Internal error');
});
