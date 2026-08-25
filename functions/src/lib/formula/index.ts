/**
 * Metric formula language: tokenizer, parser, evaluator. Grammar and rules in
 * docs/formulas.md. This module is the only place formulas are interpreted;
 * the backend never evaluates a formula as JavaScript (a test asserts it).
 */

export { evaluate, type Lookup } from './evaluate';
export { type Ast, FUNCTIONS, type FunctionName, parseCacheSize, parseFormula, parseFormulaCached } from './parse';
export { FormulaSyntaxError, type Token, tokenize } from './tokenize';
