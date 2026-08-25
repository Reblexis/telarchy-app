import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate, FormulaSyntaxError, parseCacheSize, parseFormula, parseFormulaCached } from '../lib/formula';

const num = (s: string) => evaluate(parseFormula(s), () => 0);

describe('formula parser', () => {
  test('precedence: * binds tighter than +', () => {
    expect(num('1 + 2 * 3')).toBe(7);
    expect(num('(1 + 2) * 3')).toBe(9);
  });

  test('^ is right-associative and ** is an alias', () => {
    expect(num('2 ^ 3 ^ 2')).toBe(512);
    expect(num('2 ** 3 ** 2')).toBe(512);
  });

  test('^ binds tighter than unary minus', () => {
    expect(num('-2 ^ 2')).toBe(-4);
    expect(num('(-2) ^ 2')).toBe(4);
    expect(num('2 ^ -1')).toBe(0.5);
  });

  test('unary plus and nested negation', () => {
    expect(num('+3')).toBe(3);
    expect(num('--3')).toBe(3);
    expect(num('-(-3)')).toBe(3);
  });

  test('nested parentheses and calls', () => {
    expect(num('min(max(1, 2), (3 + 4) * 2)')).toBe(2);
    expect(num('sqrt(abs(-16))')).toBe(4);
  });

  test('arity of every function', () => {
    expect(num('sqrt(9)')).toBe(3);
    expect(num('abs(-1)')).toBe(1);
    expect(num('log(1)')).toBe(0);
    expect(num('log10(1000)')).toBe(3);
    expect(num('min(5)')).toBe(5);
    expect(num('min(5, 2, 9)')).toBe(2);
    expect(num('max(5, 2, 9)')).toBe(9);
    expect(num('pow(2, 10)')).toBe(1024);
    expect(num('clamp(7, 0, 5)')).toBe(5);
    expect(() => parseFormula('sqrt(1, 2)')).toThrow('sqrt takes 1 argument, got 2 at column 1');
    expect(() => parseFormula('pow(2)')).toThrow('pow takes 2 arguments, got 1');
    expect(() => parseFormula('clamp(1, 2)')).toThrow('clamp takes 3 arguments, got 2');
    expect(() => parseFormula('min()')).toThrow('min takes at least 1 argument, got 0');
  });

  test('unknown function and bare identifier are rejected with a column', () => {
    expect(() => parseFormula('foo(1)')).toThrow('Unknown function or identifier "foo" at column 1');
    expect(() => parseFormula('1 + revenue')).toThrow('Unknown function or identifier "revenue" at column 5');
  });

  test('JavaScript constructs are rejected', () => {
    expect(() => parseFormula('1 ? 2 : 3')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('1 < 2')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('Math.sqrt(4)')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('"a"')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('1 % 2')).toThrow(FormulaSyntaxError);
  });

  test('unterminated brace, trailing garbage, stray comma, empty input', () => {
    expect(() => parseFormula('{Revenue')).toThrow('Unterminated metric reference at column 1');
    expect(() => parseFormula('1 2')).toThrow('Unexpected input at column 3');
    expect(() => parseFormula('1, 2')).toThrow('Unexpected comma outside a function call at column 2');
    expect(() => parseFormula('(1')).toThrow('Expected ")" at column 3');
    expect(() => parseFormula('')).toThrow('Empty formula at column 1');
    expect(() => parseFormula('   ')).toThrow('Empty formula at column 4');
    expect(() => parseFormula('1 +')).toThrow('Unexpected end of formula at column 4');
    expect(() => parseFormula('* 2')).toThrow('Unexpected operator "*" at column 1');
  });

  test('memo parses a repeated string once and caches errors too', () => {
    const before = parseCacheSize();
    const a = parseFormulaCached('{A} * 2 + 1');
    const b = parseFormulaCached('{A} * 2 + 1');
    expect(a).toBe(b);
    expect(parseCacheSize()).toBe(before + 1);
    expect(() => parseFormulaCached('1 +')).toThrow(FormulaSyntaxError);
    expect(() => parseFormulaCached('1 +')).toThrow(FormulaSyntaxError);
    expect(parseCacheSize()).toBe(before + 2);
  });
});

describe('no eval in the backend', () => {
  const root = join(__dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|mjs|cjs)$/.test(entry)) files.push(p);
    }
  };
  walk(root);

  test('no Function( or eval( under functions/src', () => {
    const hits = files
      .filter(f => !f.endsWith('formula-parse.test.ts'))
      .filter(f => /\bFunction\(|\beval\(/.test(readFileSync(f, 'utf8')))
      .map(f => f.slice(root.length + 1));
    expect(hits).toEqual([]);
  });
});
