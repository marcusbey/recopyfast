/**
 * Date recognition for the Outdated Website Checker (s99).
 *
 * The checker is deliberately conservative: only the English forms promised
 * by the story are recognized. The expressions below are fixed at module
 * load; none is built from page text. Every calendar component is round-tripped
 * through UTC because JavaScript otherwise turns February 30 into March 2 and
 * makes an expired-looking line out of an invalid date.
 */

export type DatePrecision = "day" | "month";

export interface RecognizedDate {
  text: string;
  start: number;
  end: number;
  precision: DatePrecision;
  year: number;
  month: number;
  day: number;
  /** End of the recognized precision, in UTC. */
  endDate: Date;
}

export interface YearReference {
  startYear: number;
  finalYear: number;
}

const MIN_YEAR = 1990;
const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MONTH =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep(?:t)?\\.?|Oct\\.?|Nov\\.?|Dec\\.?)";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
const RANGE_SEPARATOR = "[\\u2013\\u2014-]";

type MatchParser = (
  match: RegExpMatchArray,
  now: Date,
) => Omit<RecognizedDate, "text" | "start" | "end"> | null;

interface DatePattern {
  expression: RegExp;
  parse: MatchParser;
}

function monthIndex(value: string): number {
  const normalized = value.toLowerCase().replace(/\.$/, "");
  return MONTH_NAMES.findIndex((month) => month.startsWith(normalized));
}

function isAcceptedYear(year: number, now: Date): boolean {
  return year >= MIN_YEAR && year <= now.getUTCFullYear() + 5;
}

function utcEndOfDay(year: number, month: number, day: number): Date | null {
  const value = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  return value.getUTCFullYear() === year &&
    value.getUTCMonth() === month &&
    value.getUTCDate() === day
    ? value
    : null;
}

function dayValue(
  yearValue: string,
  monthValue: string,
  dayValue: string,
  now: Date,
): Omit<RecognizedDate, "text" | "start" | "end"> | null {
  const year = Number(yearValue);
  const month = monthIndex(monthValue);
  const day = Number(dayValue);
  if (!isAcceptedYear(year, now) || month < 0) return null;
  const endDate = utcEndOfDay(year, month, day);
  if (!endDate) return null;
  return { precision: "day", year, month, day, endDate };
}

function rangeValue(
  yearValue: string,
  monthValue: string,
  startDayValue: string,
  endDayValue: string,
  now: Date,
): Omit<RecognizedDate, "text" | "start" | "end"> | null {
  const startDay = Number(startDayValue);
  const endDay = Number(endDayValue);
  if (startDay > endDay) return null;
  const start = dayValue(yearValue, monthValue, startDayValue, now);
  const end = dayValue(yearValue, monthValue, endDayValue, now);
  return start && end ? end : null;
}

function monthValue(
  yearValue: string,
  monthValue: string,
  now: Date,
): Omit<RecognizedDate, "text" | "start" | "end"> | null {
  const year = Number(yearValue);
  const month = monthIndex(monthValue);
  if (!isAcceptedYear(year, now) || month < 0) return null;
  const day = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const endDate = utcEndOfDay(year, month, day);
  return endDate ? { precision: "month", year, month, day, endDate } : null;
}

const DATE_PATTERNS: readonly DatePattern[] = [
  {
    expression: new RegExp(
      `\\b(${MONTH})\\s+${DAY}\\s*${RANGE_SEPARATOR}\\s*${DAY},?\\s+(\\d{4})\\b`,
      "giu",
    ),
    parse: (match, now) =>
      rangeValue(match[4], match[1], match[2], match[3], now),
  },
  {
    expression: new RegExp(
      `\\b${DAY}\\s*${RANGE_SEPARATOR}\\s*${DAY}\\s+(${MONTH})\\s+(\\d{4})\\b`,
      "giu",
    ),
    parse: (match, now) =>
      rangeValue(match[4], match[3], match[1], match[2], now),
  },
  {
    expression: new RegExp(`\\b(${MONTH})\\s+${DAY},?\\s+(\\d{4})\\b`, "giu"),
    parse: (match, now) => dayValue(match[3], match[1], match[2], now),
  },
  {
    expression: new RegExp(`\\b${DAY}\\s+(${MONTH})\\s+(\\d{4})\\b`, "giu"),
    parse: (match, now) => dayValue(match[3], match[2], match[1], now),
  },
  {
    expression: /\b(\d{4})-(\d{2})-(\d{2})\b/gu,
    parse: (match, now) => {
      const month = String(Number(match[2]));
      const monthName = MONTH_NAMES[Number(month) - 1];
      return monthName ? dayValue(match[1], monthName, match[3], now) : null;
    },
  },
  {
    expression: new RegExp(`\\b(${MONTH})\\s+(\\d{4})\\b`, "giu"),
    parse: (match, now) => {
      const start = match.index ?? 0;
      const prefix = (match.input ?? "").slice(Math.max(0, start - 8), start);
      // An invalid `31 April 2025` must stay invalid. Without this guard the
      // shorter month/year pattern would salvage `April 2025` after the full
      // day/month parser correctly rejected the impossible day.
      if (/\b\d{1,2}(?:st|nd|rd|th)?\s+$/iu.test(prefix)) return null;
      return monthValue(match[2], match[1], now);
    },
  },
];

/** All supported dates in source order, with overlapping shorter forms removed. */
export function findRecognizedDates(text: string, now: Date): RecognizedDate[] {
  const candidates: RecognizedDate[] = [];
  for (const { expression, parse } of DATE_PATTERNS) {
    for (const match of text.matchAll(expression)) {
      const value = parse(match, now);
      if (!value) continue;
      const start = match.index ?? 0;
      candidates.push({
        text: match[0],
        start,
        end: start + match[0].length,
        ...value,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start),
  );
  const accepted: RecognizedDate[] = [];
  let occupiedUntil = -1;
  for (const candidate of candidates) {
    if (candidate.start < occupiedUntil) continue;
    accepted.push(candidate);
    occupiedUntil = candidate.end;
  }
  return accepted;
}

/** A date is past only after the final UTC instant of its precision. */
export function isPastDate(date: RecognizedDate, now: Date): boolean {
  return (
    date.endDate.getTime() <
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

/** A bare year or a compact range such as 2026/27. */
export function parseYearReference(
  text: string,
  now: Date,
): YearReference | null {
  const match = /^(\d{4})(?:\s*[/\u2013\u2014-]\s*(\d{2}|\d{4}))?$/.exec(
    text.trim(),
  );
  if (!match) return null;
  const startYear = Number(match[1]);
  let finalYear = startYear;
  if (match[2]) {
    if (match[2].length === 2) {
      finalYear = Math.floor(startYear / 100) * 100 + Number(match[2]);
      if (finalYear < startYear) finalYear += 100;
    } else {
      finalYear = Number(match[2]);
    }
  }
  if (
    !isAcceptedYear(startYear, now) ||
    !isAcceptedYear(finalYear, now) ||
    finalYear < startYear
  ) {
    return null;
  }
  return { startYear, finalYear };
}
