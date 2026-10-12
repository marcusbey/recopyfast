/**
 * The free-copy-change cost calculator's arithmetic (s98). Pure, no I/O, no
 * `window`: the page runs it in the visitor's browser and the tests run it in
 * Node.
 *
 * Every term in the result is a number the visitor typed. There is no
 * "context-switch overhead" multiplier, no industry average and no
 * ReCopyFast-supplied estimate: launch kit §11 says there are no time-saved
 * numbers to quote, and a hidden constant would make the figure a claim of
 * ours rather than the visitor's own arithmetic. If a term cannot be explained
 * in the formula sentence, it does not belong here.
 *
 * Inputs are clamped, never rejected. The page is driven by a URL a stranger
 * can edit and by a text box a visitor can empty; a calculator that throws on
 * `?sites=1e9` is a broken page, and one that prints NaN is a wrong one.
 */

export const CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type CostInputs = {
  sites: number;
  changesPerSiteMonthly: number;
  minutesPerChange: number;
  hourlyRate: number;
  billedPercent: number;
  currency: Currency;
};

export type NumericField = Exclude<keyof CostInputs, "currency">;

export const DEFAULT_INPUTS: CostInputs = {
  sites: 10,
  changesPerSiteMonthly: 2,
  minutesPerChange: 20,
  hourlyRate: 60,
  billedPercent: 0,
  currency: "USD",
};

type Limit = { min: number; max: number; step: number };

export const INPUT_LIMITS: Record<NumericField, Limit> = {
  sites: { min: 1, max: 500, step: 1 },
  changesPerSiteMonthly: { min: 0, max: 50, step: 0.5 },
  minutesPerChange: { min: 1, max: 240, step: 1 },
  // Cents: a rate of 59.50 is ordinary, and snapping it to 60 changed the sum.
  hourlyRate: { min: 0, max: 10_000, step: 0.01 },
  billedPercent: { min: 0, max: 100, step: 1 },
};

const NUMERIC_FIELDS = Object.keys(INPUT_LIMITS) as NumericField[];

/** Locale is fixed so the pinned copy and the tests do not depend on the host. */
const LOCALE = "en-US";
const MINUTES_PER_HOUR = 60;
const MONTHS_PER_YEAR = 12;

export type CostResult = {
  /** The inputs after clamping: what the figures below were computed from. */
  inputs: CostInputs;
  changesMonthly: number;
  hoursMonthly: number;
  unbilledHoursMonthly: number;
  unbilledMonthly: number;
  unbilledYearly: number;
  formatted: {
    hoursMonthly: string;
    unbilledHoursMonthly: string;
    unbilledMonthly: string;
    unbilledYearly: string;
    hourlyRate: string;
  };
  formula: string;
};

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function clampField(field: NumericField, value: unknown): number {
  const { min, max, step } = INPUT_LIMITS[field];
  const number = toFiniteNumber(value);
  if (!Number.isFinite(number)) return DEFAULT_INPUTS[field];
  const clamped = Math.min(max, Math.max(min, number));
  // Snap to the field's step (whole numbers, halves for changes, cents for the
  // rate). Limits are multiples of the step, so snapping cannot leave the
  // range. `toFixed` drops float noise such as 0.30000000000000004.
  return Number((Math.round(clamped / step) * step).toFixed(2));
}

function isCurrency(value: unknown): value is Currency {
  return (CURRENCIES as readonly unknown[]).includes(value);
}

/**
 * Reads only the six known fields, by name, off whatever it is handed. Values
 * from a URL or an input arrive as strings; anything else non-numeric falls
 * back to the default. The result is a fresh object: nothing the caller passed
 * is spread into it.
 */
export function clampInputs(
  raw: Partial<Record<keyof CostInputs, unknown>>,
): CostInputs {
  const numbers = Object.fromEntries(
    NUMERIC_FIELDS.map((field) => [field, clampField(field, raw[field])]),
  ) as Record<NumericField, number>;

  return {
    ...numbers,
    currency: isCurrency(raw.currency) ? raw.currency : DEFAULT_INPUTS.currency,
  };
}

const numberFormat = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 1,
});
const hoursFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const wholeFormat = new Intl.NumberFormat(LOCALE);
const roundedFormat = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 2,
});

export function formatMoney(
  amount: number,
  currency: Currency,
  fractionDigits = 0,
): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

function plural(count: number, singular: string, many: string): string {
  return `${numberFormat.format(count)} ${count === 1 ? singular : many}`;
}

/** "10 sites × 2 changes a month × 20 minutes": the first half of the formula. */
export function describeTerms(inputs: CostInputs): string {
  return [
    plural(inputs.sites, "site", "sites"),
    `${plural(inputs.changesPerSiteMonthly, "change", "changes")} a month`,
    plural(inputs.minutesPerChange, "minute", "minutes"),
  ].join(" × ");
}

export function calculateCost(raw: CostInputs): CostResult {
  const inputs = clampInputs(raw);
  const changesMonthly = inputs.sites * inputs.changesPerSiteMonthly;
  const hoursMonthly =
    (changesMonthly * inputs.minutesPerChange) / MINUTES_PER_HOUR;
  const unbilledHoursMonthly = hoursMonthly * (1 - inputs.billedPercent / 100);
  const unbilledMonthly = unbilledHoursMonthly * inputs.hourlyRate;
  const unbilledYearly = unbilledMonthly * MONTHS_PER_YEAR;

  const formatted = {
    hoursMonthly: hoursFormat.format(hoursMonthly),
    unbilledHoursMonthly: hoursFormat.format(unbilledHoursMonthly),
    unbilledMonthly: formatMoney(unbilledMonthly, inputs.currency),
    unbilledYearly: formatMoney(unbilledYearly, inputs.currency),
    // Cents only when the rate has them: "$60", but "$59.50".
    hourlyRate: formatMoney(
      inputs.hourlyRate,
      inputs.currency,
      Number.isInteger(inputs.hourlyRate) ? 0 : 2,
    ),
  };

  const formula =
    `${describeTerms(inputs)} = ${formatted.hoursMonthly} hours a month. ` +
    `At ${formatted.hourlyRate} an hour with ${inputs.billedPercent}% billed, ` +
    `that's ${formatted.unbilledMonthly} a month and ${formatted.unbilledYearly} a year.`;

  return {
    inputs,
    changesMonthly,
    hoursMonthly,
    unbilledHoursMonthly,
    unbilledMonthly,
    unbilledYearly,
    formatted,
    formula,
  };
}

/**
 * The inline hint for a text box whose current text is not a usable value.
 * The calculation still runs, on the clamped (or default) value, so the result
 * never shows NaN; this only tells the visitor why their number was not used
 * as typed.
 */
export function describeFieldIssue(
  field: NumericField,
  rawText: string,
): string | null {
  const { min, max } = INPUT_LIMITS[field];
  const number = toFiniteNumber(rawText);
  if (Number.isFinite(number) && number >= min && number <= max) return null;
  return `Between ${wholeFormat.format(min)} and ${wholeFormat.format(max)}`;
}

/**
 * The note for a number in range that the calculation does not use as typed:
 * 2.3 sites is computed as 2, and until s98's review nothing said so. Range
 * problems stay with `describeFieldIssue`; this is for a value that is fine
 * but off its step.
 */
export function describeFieldRounding(
  field: NumericField,
  rawText: string,
): string | null {
  if (describeFieldIssue(field, rawText) !== null) return null;
  const typed = Number(rawText);
  const used = clampField(field, typed);
  if (Math.abs(used - typed) < 1e-9) return null;
  return `Rounded to ${roundedFormat.format(used)}`;
}
