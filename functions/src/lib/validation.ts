/**
 * Shared input validation helpers.
 * Each returns undefined on success, or an error message string on failure.
 */

/** Agent IDs: alphanumeric, hyphens, underscores. 1–64 chars. */
export function validateAgentId(id: unknown): string | undefined {
  if (typeof id !== 'string') return 'agentId must be a string';
  if (id.length < 1 || id.length > 64) return 'agentId must be 1–64 characters';
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return 'agentId must contain only letters, numbers, hyphens, and underscores';
  return undefined;
}

/** Free-text content fields (task descriptions, messages, metric descriptions). Max 10,000 chars. */
export function validateContent(value: unknown, fieldName = 'content', maxLength = 10_000): string | undefined {
  if (typeof value !== 'string') return `${fieldName} must be a string`;
  if (value.length > maxLength) return `${fieldName} must be at most ${maxLength} characters`;
  return undefined;
}

/** On-chain transaction hashes: 0x followed by 64 hex characters. */
export function validateTxHash(hash: unknown): string | undefined {
  if (typeof hash !== 'string') return 'txHash must be a string';
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) return 'txHash must be a 0x-prefixed 64-character hex string';
  return undefined;
}
