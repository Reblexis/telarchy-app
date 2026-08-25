/**
 * Metric formula language: tokenizer, parser, evaluator. Grammar and rules in
 * docs/formulas.md. This module is the only place formulas are interpreted;
 * the backend never evaluates a formula as JavaScript (a test asserts it).
 */
export { tokenize, FormulaSyntaxError, type Token } from './tokenize';
export { parseFormula, parseFormulaCached, parseCacheSize, FUNCTIONS, type Ast, type FunctionName } from './parse';
export { evaluate, type Lookup } from './evaluate';
