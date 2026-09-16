import { AppError } from './errors';

/** Validate display wording without evaluating expressions or changing a market. */
export function parseOptionQuestionTemplate(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') throw new AppError('optionQuestionTemplate must be a string or null', 400);
  const text = raw.trim();
  if (!text) return null;
  if (text.length > 500) throw new AppError('Question wording must be at most 500 characters', 400);
  const rest = text.replace(/\{(option|workspace|metric|date)\}/g, '');
  if (/[{}]/.test(rest)) throw new AppError('Use only {option}, {workspace}, {metric} and {date} placeholders', 400);
  if (!text.includes('{option}')) throw new AppError('Question wording must include {option}', 400);
  return text;
}
