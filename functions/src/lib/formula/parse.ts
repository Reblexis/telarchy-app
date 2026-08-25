/**
 * Recursive-descent parser for metric formulas. Grammar: docs/formulas.md.
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := '-' unary | power
 *   power  := atom ('^' unary)?            right-associative; '**' is an alias
 *   atom   := number | '{' ref '}' | func '(' args ')' | '(' expr ')'
 *
 * The parser produces a small AST that the evaluator walks. Nothing here can
 * execute code: a formula is data until `evaluate` interprets it.
 */
import { FormulaSyntaxError, type Token, tokenize } from './tokenize';

export type Ast =
  | { type: 'num'; value: number }
  | { type: 'ref'; name: string }
  | { type: 'neg'; arg: Ast }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Ast; right: Ast }
  | { type: 'call'; name: FunctionName; args: Ast[] };

export type FunctionName = 'sqrt' | 'abs' | 'log' | 'log10' | 'min' | 'max' | 'pow' | 'clamp';

/** Accepted functions and their arity. `null` means one or more arguments. */
export const FUNCTIONS: Record<FunctionName, number | null> = {
  sqrt: 1,
  abs: 1,
  log: 1,
  log10: 1,
  min: null,
  max: null,
  pow: 2,
  clamp: 3,
};

function isFunctionName(name: string): name is FunctionName {
  return Object.prototype.hasOwnProperty.call(FUNCTIONS, name);
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }

  parseAll(): Ast {
    const first = this.peek();
    if (first.kind === 'eof') throw new FormulaSyntaxError('Empty formula', first.column);
    const ast = this.expr();
    const tail = this.peek();
    if (tail.kind !== 'eof') {
      throw new FormulaSyntaxError(
        tail.kind === 'comma' ? 'Unexpected comma outside a function call' : 'Unexpected input',
        tail.column,
      );
    }
    return ast;
  }

  private expr(): Ast {
    let left = this.term();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && (t.value === '+' || t.value === '-')) {
        this.next();
        left = { type: 'bin', op: t.value, left, right: this.term() };
      } else {
        return left;
      }
    }
  }

  private term(): Ast {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && (t.value === '*' || t.value === '/')) {
        this.next();
        left = { type: 'bin', op: t.value, left, right: this.unary() };
      } else {
        return left;
      }
    }
  }

  private unary(): Ast {
    const t = this.peek();
    if (t.kind === 'op' && t.value === '-') {
      this.next();
      return { type: 'neg', arg: this.unary() };
    }
    if (t.kind === 'op' && t.value === '+') {
      this.next();
      return this.unary();
    }
    return this.power();
  }

  private power(): Ast {
    const base = this.atom();
    const t = this.peek();
    if (t.kind === 'op' && t.value === '^') {
      this.next();
      // Right-associative, and the exponent may carry its own unary minus.
      return { type: 'bin', op: '^', left: base, right: this.unary() };
    }
    return base;
  }

  private atom(): Ast {
    const t = this.next();
    switch (t.kind) {
      case 'num':
        return { type: 'num', value: t.value };
      case 'ref':
        return { type: 'ref', name: t.name };
      case 'lparen': {
        const inner = this.expr();
        const close = this.next();
        if (close.kind !== 'rparen') throw new FormulaSyntaxError('Expected ")"', close.column);
        return inner;
      }
      case 'ident': {
        if (!isFunctionName(t.name)) {
          throw new FormulaSyntaxError(`Unknown function or identifier "${t.name}"`, t.column);
        }
        const open = this.next();
        if (open.kind !== 'lparen') throw new FormulaSyntaxError(`Expected "(" after ${t.name}`, open.column);
        const args: Ast[] = [];
        if (this.peek().kind !== 'rparen') {
          for (;;) {
            args.push(this.expr());
            const sep = this.peek();
            if (sep.kind === 'comma') {
              this.next();
              continue;
            }
            break;
          }
        }
        const close = this.next();
        if (close.kind !== 'rparen')
          throw new FormulaSyntaxError('Expected ")" to close the argument list', close.column);
        const arity = FUNCTIONS[t.name];
        if (arity === null ? args.length < 1 : args.length !== arity) {
          const want = arity === null ? 'at least 1 argument' : `${arity} argument${arity === 1 ? '' : 's'}`;
          throw new FormulaSyntaxError(`${t.name} takes ${want}, got ${args.length}`, t.column);
        }
        return { type: 'call', name: t.name, args };
      }
      case 'op':
        throw new FormulaSyntaxError(`Unexpected operator "${t.value}"`, t.column);
      case 'rparen':
        throw new FormulaSyntaxError('Unexpected ")"', t.column);
      case 'comma':
        throw new FormulaSyntaxError('Unexpected comma', t.column);
      case 'eof':
        throw new FormulaSyntaxError('Unexpected end of formula', t.column);
    }
  }
}

/** Parse a formula string into an AST. Throws FormulaSyntaxError with a column. */
export function parseFormula(formula: string): Ast {
  return new Parser(tokenize(formula)).parseAll();
}

const MEMO_LIMIT = 1000;
const memo = new Map<string, Ast | FormulaSyntaxError>();

/**
 * Memoised parse. The engine evaluates the same formula string once per metric
 * per sampled time point, so the parse is cached per string; the cache is
 * bounded and simply cleared when full (formulas are few and short).
 */
export function parseFormulaCached(formula: string): Ast {
  const hit = memo.get(formula);
  if (hit !== undefined) {
    if (hit instanceof FormulaSyntaxError) throw hit;
    return hit;
  }
  if (memo.size >= MEMO_LIMIT) memo.clear();
  try {
    const ast = parseFormula(formula);
    memo.set(formula, ast);
    return ast;
  } catch (e) {
    if (e instanceof FormulaSyntaxError) memo.set(formula, e);
    throw e;
  }
}

/** Test hook: how many formulas the parse cache currently holds. */
export function parseCacheSize(): number {
  return memo.size;
}
