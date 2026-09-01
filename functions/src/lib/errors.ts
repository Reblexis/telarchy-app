import type { ErrorCode } from './error-codes';

/**
 * An error whose message is written for the caller.
 *
 * `code` is the machine-readable name (lib/error-codes.ts). It is optional
 * because coverage is partial by design: the errors a participant branches on
 * carry one, the rest do not yet, and an absent code means "not coded yet".
 * `extra` is merged into the response body as it always was.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public status: number,
    public extra?: Record<string, unknown>,
    public code?: ErrorCode,
  ) {
    super(message);
  }
}
