/**
 * AST evaluator for metric formulas. Grammar: docs/formulas.md.
 *
 * Pure arithmetic over numbers. Metric references are resolved through the
 * `lookup` callback; a lookup that returns `null` (a metric with no value yet)
 * makes the whole result `null`, mirroring the engine's contract that an
 * unknown-yet input yields an unknown-yet output. Everything else follows IEEE
 * doubles as JavaScript's own operators do (1/0 is Infinity, sqrt(-1) is NaN);
 * the engine decides what NaN means (it maps to 0 with a logged error).
 */
import type { Ast, FunctionName } from './parse';

export type Lookup = (name: string) => number | null;

const NULL = Symbol('null-input');

function apply(name: FunctionName, args: number[]): number {
  switch (name) {
    case 'sqrt':
      return Math.sqrt(args[0]);
    case 'abs':
      return Math.abs(args[0]);
    case 'log':
      return Math.log(args[0]);
    case 'log10':
      return Math.log10(args[0]);
    case 'min':
      return Math.min(...args);
    case 'max':
      return Math.max(...args);
    case 'pow':
      return args[0] ** args[1];
    case 'clamp':
      return Math.min(Math.max(args[0], args[1]), args[2]);
  }
}

function walk(node: Ast, lookup: Lookup): number | typeof NULL {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'ref': {
      const v = lookup(node.name);
      return v === null ? NULL : v;
    }
    case 'neg': {
      const v = walk(node.arg, lookup);
      return v === NULL ? NULL : -v;
    }
    case 'bin': {
      const l = walk(node.left, lookup);
      if (l === NULL) return NULL;
      const r = walk(node.right, lookup);
      if (r === NULL) return NULL;
      switch (node.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return l / r;
        case '^':
          return l ** r;
      }
      break;
    }
    case 'call': {
      const args: number[] = [];
      for (const a of node.args) {
        const v = walk(a, lookup);
        if (v === NULL) return NULL;
        args.push(v);
      }
      return apply(node.name, args);
    }
  }
  return NULL;
}

/** Evaluate an AST. Returns null when any referenced metric resolves to null. */
export function evaluate(ast: Ast, lookup: Lookup): number | null {
  const v = walk(ast, lookup);
  return v === NULL ? null : v;
}
