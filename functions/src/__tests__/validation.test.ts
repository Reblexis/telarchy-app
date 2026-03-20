import { validateAgentId, validateContent, validateTxHash } from '../lib/validation';

describe('validateAgentId', () => {
  test('accepts valid IDs', () => {
    expect(validateAgentId('my-agent')).toBeUndefined();
    expect(validateAgentId('agent_1')).toBeUndefined();
    expect(validateAgentId('ABC123')).toBeUndefined();
    expect(validateAgentId('a')).toBeUndefined();
    expect(validateAgentId('a'.repeat(64))).toBeUndefined();
  });

  test('rejects non-string', () => {
    expect(validateAgentId(123)).toBeDefined();
    expect(validateAgentId(null)).toBeDefined();
    expect(validateAgentId(undefined)).toBeDefined();
  });

  test('rejects empty string', () => {
    expect(validateAgentId('')).toBeDefined();
  });

  test('rejects IDs longer than 64 chars', () => {
    expect(validateAgentId('a'.repeat(65))).toBeDefined();
  });

  test('rejects special characters', () => {
    expect(validateAgentId('agent name')).toBeDefined(); // space
    expect(validateAgentId('agent@1')).toBeDefined();    // @
    expect(validateAgentId('agent.1')).toBeDefined();    // dot
    expect(validateAgentId('agent/1')).toBeDefined();    // slash
  });
});

describe('validateContent', () => {
  test('accepts normal strings', () => {
    expect(validateContent('hello world')).toBeUndefined();
    expect(validateContent('')).toBeUndefined(); // empty is ok — required check is upstream
    expect(validateContent('a'.repeat(10_000))).toBeUndefined();
  });

  test('rejects non-string', () => {
    expect(validateContent(42)).toBeDefined();
    expect(validateContent(null)).toBeDefined();
  });

  test('rejects strings over max length', () => {
    expect(validateContent('a'.repeat(10_001))).toBeDefined();
  });

  test('respects custom maxLength', () => {
    expect(validateContent('a'.repeat(200), 'title', 200)).toBeUndefined();
    expect(validateContent('a'.repeat(201), 'title', 200)).toBeDefined();
  });

  test('includes field name in error message', () => {
    const err = validateContent('a'.repeat(300), 'description', 200);
    expect(err).toContain('description');
  });
});

describe('validateTxHash', () => {
  test('accepts valid 66-char hex hash', () => {
    const valid = '0x' + 'a'.repeat(64);
    expect(validateTxHash(valid)).toBeUndefined();
    expect(validateTxHash('0x' + '1234567890abcdefABCDEF'.repeat(2) + '0'.repeat(20))).toBeUndefined();
  });

  test('rejects non-string', () => {
    expect(validateTxHash(12345)).toBeDefined();
    expect(validateTxHash(null)).toBeDefined();
  });

  test('rejects missing 0x prefix', () => {
    expect(validateTxHash('a'.repeat(64))).toBeDefined();
  });

  test('rejects wrong length', () => {
    expect(validateTxHash('0x' + 'a'.repeat(63))).toBeDefined(); // too short
    expect(validateTxHash('0x' + 'a'.repeat(65))).toBeDefined(); // too long
  });

  test('rejects non-hex characters', () => {
    expect(validateTxHash('0x' + 'g'.repeat(64))).toBeDefined();
    expect(validateTxHash('0x' + 'z'.repeat(64))).toBeDefined();
  });
});
