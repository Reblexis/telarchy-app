import { FormulaSyntaxError, tokenize } from '../lib/formula';

const kinds = (s: string) => tokenize(s).map(t => t.kind);

describe('formula tokenizer', () => {
  test('numbers: integers, decimals, leading dot, exponent', () => {
    const toks = tokenize('42 3.14 .5 1e3 2.5E-2');
    expect(toks.filter(t => t.kind === 'num').map(t => (t as { value: number }).value)).toEqual([
      42, 3.14, 0.5, 1000, 0.025,
    ]);
  });

  test('metric references keep the trimmed name and the column', () => {
    const [ref] = tokenize('  { Weekly revenue }');
    expect(ref).toEqual({ kind: 'ref', name: 'Weekly revenue', column: 3 });
  });

  test('every operator, parentheses and comma', () => {
    expect(kinds('1+2-3*4/5^6,(7)')).toEqual([
      'num',
      'op',
      'num',
      'op',
      'num',
      'op',
      'num',
      'op',
      'num',
      'op',
      'num',
      'comma',
      'lparen',
      'num',
      'rparen',
      'eof',
    ]);
  });

  test('** is tokenized as the ^ operator', () => {
    const toks = tokenize('2**3');
    expect(toks[1]).toEqual({ kind: 'op', value: '^', column: 2 });
  });

  test('identifiers are tokenized (the parser decides if they are functions)', () => {
    expect(tokenize('sqrt(4)')[0]).toEqual({ kind: 'ident', name: 'sqrt', column: 1 });
  });

  test('unknown character reports its column', () => {
    expect(() => tokenize('1 + 2 % 3')).toThrow(FormulaSyntaxError);
    try {
      tokenize('1 + 2 % 3');
    } catch (e) {
      expect((e as FormulaSyntaxError).column).toBe(7);
      expect((e as Error).message).toBe('Unexpected character "%" at column 7');
    }
  });

  test('unterminated and empty references', () => {
    expect(() => tokenize('{Revenue')).toThrow('Unterminated metric reference at column 1');
    expect(() => tokenize('1 + { }')).toThrow('Empty metric reference at column 5');
  });

  test('eof column is one past the end', () => {
    const toks = tokenize('12');
    expect(toks[toks.length - 1]).toEqual({ kind: 'eof', column: 3 });
  });
});
