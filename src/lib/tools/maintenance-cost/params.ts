import { clampInputs, type CostInputs } from "./calculate";

/**
 * URL state for the calculator: `?sites=&changes=&minutes=&rate=&billed=&currency=`.
 *
 * The URL is untrusted input from anyone who can send a link. So this reads
 * exactly six keys, each by name through `.get`, and hands the strings to
 * `clampInputs`, which turns them into numbers and an enum member. No key the
 * URL supplies is ever used as a property name, so `__proto__=x` and
 * `constructor=y` have nothing to land on.
 */
export type ParamReader = { get(name: string): string | null };

/** Canonical order: also the order of the pasted card's link. */
const PARAM_KEYS = [
  ["sites", "sites"],
  ["changes", "changesPerSiteMonthly"],
  ["minutes", "minutesPerChange"],
  ["rate", "hourlyRate"],
  ["billed", "billedPercent"],
  ["currency", "currency"],
] as const satisfies readonly (readonly [string, keyof CostInputs])[];

export function parseParams(reader: ParamReader): CostInputs {
  return clampInputs({
    sites: reader.get("sites"),
    changesPerSiteMonthly: reader.get("changes"),
    minutesPerChange: reader.get("minutes"),
    hourlyRate: reader.get("rate"),
    billedPercent: reader.get("billed"),
    currency: reader.get("currency"),
  });
}

/** Always the clamped value, so a URL never carries something the page would not show. */
export function serializeParams(inputs: CostInputs): string {
  const clamped = clampInputs(inputs);
  return PARAM_KEYS.map(
    ([key, field]) => `${key}=${encodeURIComponent(String(clamped[field]))}`,
  ).join("&");
}
