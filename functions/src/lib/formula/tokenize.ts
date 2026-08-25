/**
 * Formula tokenizer.
 *
 * Grammar and rejection rules: docs/formulas.md. This is the first stage of the
 * hand-written parser that replaced JavaScript evaluation on 2026-08-24 (the
 * admin-reachable eval known as C1 in the security review). The tokenizer only
 * knows the characters the grammar allows; anything else is a syntax error that
 * names the column, so a formula can never reach a JavaScript evaluator.
 */

export type Token =
  | { kind: 'num'; value: number; column: number }
  | { kind: 'ref'; name: string; column: number }
  | { kind: 'ident'; name: string; column: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^'; column: number }
  | { kind: 'lparen' | 'rparen' | 'comma' | 'eof'; column: number };

export class FormulaSyntaxError extends Error {
  /** 1-based column in the original formula string. */
  readonly column: number;
  constructor(message: string, column: number) {
    super(`${message} at column ${column}`);
    this.name = 'FormulaSyntaxError';
    this.column = column;
  }
}

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

export function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    const column = i + 1;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '{') {
      const close = formula.indexOf('}', i + 1);
      if (close === -1) throw new FormulaSyntaxError('Unterminated metric reference', column);
      const name = formula.slice(i + 1, close).trim();
      if (!name) throw new FormulaSyntaxError('Empty metric reference', column);
      tokens.push({ kind: 'ref', name, column });
      i = close + 1;
      continue;
    }
    const rest = formula.slice(i);
    const num = NUMBER.exec(rest);
    if (num) {
      tokens.push({ kind: 'num', value: Number(num[0]), column });
      i += num[0].length;
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      tokens.push({ kind: 'ident', name: id[0], column });
      i += id[0].length;
      continue;
    }
    if (ch === '*' && formula[i + 1] === '*') {
      tokens.push({ kind: 'op', value: '^', column });
      i += 2;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      tokens.push({ kind: 'op', value: ch, column });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', column });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', column });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', column });
      i++;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected character "${ch}"`, column);
  }
  tokens.push({ kind: 'eof', column: formula.length + 1 });
  return tokens;
}
