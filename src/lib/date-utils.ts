/**
 * Parse and convert relative date strings to absolute dates.
 * Supports formats: +10d, +2w, +3m, +1y
 */

export interface RelativeDateMatch {
  amount: number;
  unit: 'd' | 'w' | 'm' | 'y';
}

const RELATIVE_DATE_RE = /^\+(\d+)(d|w|m|y)$/;

/**
 * Check if a date string is in relative format (+10d, +2w, etc.)
 */
export function isRelativeDate(dateStr: string): boolean {
  return RELATIVE_DATE_RE.test(dateStr);
}

/**
 * Parse a relative date string and return the amount and unit.
 * Returns null if the string is not a valid relative date.
 */
export function parseRelativeDate(dateStr: string): RelativeDateMatch | null {
  const match = dateStr.match(RELATIVE_DATE_RE);
  if (!match) return null;
  
  return {
    amount: parseInt(match[1], 10),
    unit: match[2] as 'd' | 'w' | 'm' | 'y',
  };
}

/**
 * Convert a relative date string to an absolute YYYY-MM-DD date string.
 * Uses the provided baseDate (defaults to current date).
 */
export function relativeToAbsoluteDate(dateStr: string, baseDate: Date = new Date()): string {
  const parsed = parseRelativeDate(dateStr);
  if (!parsed) return dateStr; // Return as-is if not relative
  
  const result = new Date(baseDate);
  
  switch (parsed.unit) {
    case 'd':
      result.setDate(result.getDate() + parsed.amount);
      break;
    case 'w':
      result.setDate(result.getDate() + parsed.amount * 7);
      break;
    case 'm':
      result.setMonth(result.getMonth() + parsed.amount);
      break;
    case 'y':
      result.setFullYear(result.getFullYear() + parsed.amount);
      break;
  }
  
  return result.toISOString().slice(0, 10);
}

/**
 * Convert any date string (relative or absolute) to absolute YYYY-MM-DD format.
 */
export function toAbsoluteDate(dateStr: string, baseDate: Date = new Date()): string {
  if (isRelativeDate(dateStr)) {
    return relativeToAbsoluteDate(dateStr, baseDate);
  }
  return dateStr;
}
