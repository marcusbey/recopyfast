/**
 * Precision-first stale-copy rules for s99.
 *
 * This module receives ONE extracted block at a time. Keeping that boundary in
 * the API is intentional: the first plan described nearby-keyword checks, and
 * concatenating blocks would let a footer's "register" turn an unrelated blog
 * date into a finding. Character distances below therefore cannot cross the
 * extractor's block boundary.
 */

import { createFinding, type Finding } from "@/lib/tools/lens";
import {
  findRecognizedDates,
  isPastDate,
  parseYearReference,
  type RecognizedDate,
} from "./dates";
import { findSeasonMentions, isInSeason } from "./seasons";

export type RuleLevel = "stale" | "warn" | "info";

export interface RuleFinding {
  finding: Finding;
  level: RuleLevel;
  /** Source order inside the block; not persisted in the generic report. */
  start: number;
}

interface Span {
  text: string;
  start: number;
  end: number;
}

interface YearSpan extends Span {
  startYear: number;
  finalYear: number;
}

const COPYRIGHT = /©|\(c\)|\bcopyright\b/giu;
const YEAR_REFERENCE =
  /\b(?:1\d{3}|2\d{3})(?:\s*[/\u2013\u2014-]\s*(?:\d{2}|(?:1|2)\d{3}))?\b/gu;
const FUTURE_WORDING =
  /\b(?:upcoming|join\s+us|register|book(?:\s+now|\s+your)|save\s+the\s+date|tickets?|rsvp|reserve|apply\s+by|deadline|ends?|ending|until|valid\s+(?:until|through)|offers?|sales?|starts?|opens?|opening|launch(?:ing)?|coming|next)\b/giu;
const HISTORICAL_WORDING =
  /\b(?:since|founded|established|published|posted(?:\s+on)?|last\s+updated|updated|began)\b/giu;
const PRICE_WORDING =
  /\b(?:prices?|pricing|rates?|menus?|price\s+lists?|fees?|catalogues?|catalogs?|collections?|schedules?|timetables?)\b/giu;
const FUTURE_YEAR_PHRASE =
  /\b(?:coming(?:\s+soon)?|launching|opening|arriving|new)\s+(?:in|for)\s+((?:19|20)\d{2})\b/giu;
const SALE_WORDING = /\b(?:sales?|offers?)\b/giu;

function spans(text: string, expression: RegExp): Span[] {
  return Array.from(text.matchAll(expression), (match) => {
    const start = match.index ?? 0;
    return { text: match[0], start, end: start + match[0].length };
  });
}

function yearSpans(text: string, now: Date): YearSpan[] {
  return Array.from(text.matchAll(YEAR_REFERENCE)).flatMap((match) => {
    const parsed = parseYearReference(match[0], now);
    if (!parsed) return [];
    const start = match.index ?? 0;
    return [{ text: match[0], start, end: start + match[0].length, ...parsed }];
  });
}

function distance(
  left: Pick<Span, "start" | "end">,
  right: Pick<Span, "start" | "end">,
): number {
  if (left.end <= right.start) return right.start - left.end;
  if (right.end <= left.start) return left.start - right.end;
  return 0;
}

function nearby(
  target: Pick<Span, "start" | "end">,
  candidates: readonly Span[],
  maximum: number,
): Span | undefined {
  return candidates
    .filter((candidate) => distance(target, candidate) <= maximum)
    .sort((left, right) => distance(target, left) - distance(target, right))[0];
}

function addFinding(
  found: RuleFinding[],
  text: string,
  page: string,
  span: Span,
  kind: string,
  level: RuleLevel,
  note: string,
): void {
  found.push({
    level,
    start: span.start,
    finding: createFinding({
      page,
      kind,
      match: span.text,
      before: text.slice(0, span.start),
      after: text.slice(span.end),
      note,
    }),
  });
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function endOfShiftedUtcDay(now: Date, years: number): number {
  const targetYear = now.getUTCFullYear() - years;
  const month = now.getUTCMonth();
  const requestedDay = now.getUTCDate();
  const finalDay = [
    31,
    isLeapYear(targetYear) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month];
  return Date.UTC(
    targetYear,
    month,
    Math.min(requestedDay, finalDay),
    23,
    59,
    59,
    999,
  );
}

function dateSpan(date: RecognizedDate): Span {
  return { text: date.text, start: date.start, end: date.end };
}

export function analyzeOutdatedBlock(
  text: string,
  page: string,
  now: Date,
): RuleFinding[] {
  const found: RuleFinding[] = [];
  const years = yearSpans(text, now);
  const rawYears = spans(text, YEAR_REFERENCE);
  const copyrights = spans(text, COPYRIGHT);
  const futureWords = spans(text, FUTURE_WORDING);
  const historicalWords = spans(text, HISTORICAL_WORDING);
  const priceWords = spans(text, PRICE_WORDING);
  const saleWords = spans(text, SALE_WORDING);

  for (const year of years) {
    if (year.finalYear >= now.getUTCFullYear()) continue;
    if (nearby(year, copyrights, 20)) {
      const isGrace = now.getUTCMonth() === 0 && now.getUTCDate() <= 31;
      addFinding(
        found,
        text,
        page,
        year,
        isGrace ? "copyright-year-grace" : "copyright-year",
        isGrace ? "info" : "stale",
        isGrace
          ? `The copyright year ends before ${now.getUTCFullYear()}, but January is treated as a review grace period.`
          : `The copyright year ends before ${now.getUTCFullYear()}.`,
      );
    }

    if (nearby(year, priceWords, 60)) {
      addFinding(
        found,
        text,
        page,
        year,
        "dated-prices",
        "stale",
        `A price, rate, menu or schedule is labelled with a year before ${now.getUTCFullYear()}.`,
      );
    }
  }

  for (const date of findRecognizedDates(text, now)) {
    if (!isPastDate(date, now)) continue;
    const target = dateSpan(date);
    if (
      nearby(target, futureWords, 60) &&
      !nearby(target, historicalWords, 60)
    ) {
      addFinding(
        found,
        text,
        page,
        target,
        "past-date-upcoming",
        "stale",
        "This date has passed, but nearby wording still presents it as upcoming, bookable or a deadline.",
      );
    }

    const prefix = text.slice(Math.max(0, date.start - 32), date.start);
    if (/\b(?:last\s+)?updated\s*:\s*$/iu.test(prefix)) {
      const threshold = endOfShiftedUtcDay(now, 2);
      if (date.endDate.getTime() < threshold) {
        addFinding(
          found,
          text,
          page,
          target,
          "stale-updated",
          "info",
          "This update label is more than two calendar years old.",
        );
      }
    }
  }

  for (const match of text.matchAll(FUTURE_YEAR_PHRASE)) {
    const parsed = parseYearReference(match[1], now);
    if (!parsed || parsed.finalYear >= now.getUTCFullYear()) continue;
    const start = match.index ?? 0;
    addFinding(
      found,
      text,
      page,
      { text: match[0], start, end: start + match[0].length },
      "past-future-tense",
      "stale",
      `This line still announces something for a year before ${now.getUTCFullYear()}.`,
    );
  }

  for (const season of findSeasonMentions(text)) {
    const nearbyYears = years.filter((year) => distance(season, year) <= 60);
    const staleYear = nearbyYears.find(
      (year) =>
        year.finalYear < now.getUTCFullYear() && distance(season, year) <= 20,
    );
    if (staleYear) {
      addFinding(
        found,
        text,
        page,
        season,
        "seasonal-promo-past-year",
        "stale",
        `This seasonal promotion names a year before ${now.getUTCFullYear()}.`,
      );
      continue;
    }
    if (
      // Independent review caught two opposite failures here. Accepted-year
      // filtering called 1989/2035 "undated"; accepting every four-digit token
      // then hid a real warning beside extension 5555. A plausible 1xxx/2xxx
      // year or range answers presence, while `yearSpans` separately decides
      // whether that value is accepted and stale.
      !nearby(season, rawYears, 60) &&
      nearby(season, saleWords, 60) &&
      !isInSeason(season.id, now)
    ) {
      addFinding(
        found,
        text,
        page,
        season,
        "seasonal-promo-out-of-season",
        "warn",
        "This undated seasonal sale is still visible outside its broad season.",
      );
    }
  }

  return found.sort((left, right) => left.start - right.start);
}
