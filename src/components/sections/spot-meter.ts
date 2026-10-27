/**
 * The capped lifetime Agency count as the pricing section may draw it (s124).
 *
 * The meter renders one DOM node per spot, so `limit` is no longer just a
 * number in a sentence: it is how many elements the page creates. The server
 * read (`getFoundingAgencyAvailability`, src/lib/billing/founding-agency.ts)
 * passes the RPC row through without a bounds check, and `/api/pricing` is
 * cached at two layers — a proxy's 200 error page, a truncated body or a bad
 * row would otherwise reach the page as a 5,000-cell meter, a negative one, or
 * a scarcity claim nobody holds. Anything that fails here takes the card's
 * "Availability temporarily unavailable" path, never a guess.
 *
 * At least as strict as `parseFoundingOfferAvailability`
 * (src/hooks/useFoundingOffer.ts), plus the cell cap and an own-property read:
 * a value inherited through the prototype chain is not a count the server sent.
 */

/** The most cells the meter will ever draw; a larger `limit` is "unknown". */
export const SPOT_METER_MAX_CELLS = 100;

export interface SpotAvailability {
  limit: number;
  remaining: number;
  soldOut: boolean;
}

export type SpotMeterCell = "taken" | "next" | "left";

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function ownField(record: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

export function parseSpotAvailability(value: unknown): SpotAvailability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const limit = ownField(value, "limit");
  const remaining = ownField(value, "remaining");
  const soldOut = ownField(value, "soldOut");
  if (
    !isInteger(limit) ||
    limit < 1 ||
    limit > SPOT_METER_MAX_CELLS ||
    !isInteger(remaining) ||
    remaining < 0 ||
    remaining > limit ||
    typeof soldOut !== "boolean" ||
    soldOut !== (remaining === 0)
  ) {
    return null;
  }
  return { limit, remaining, soldOut };
}

/**
 * One entry per spot, in order: the sold ones, then the one a buyer would get
 * next, then the rest. Callers pass a parsed count; nothing here re-checks it.
 */
export function spotMeterCells(
  limit: number,
  remaining: number,
): SpotMeterCell[] {
  const taken = limit - remaining;
  return Array.from({ length: limit }, (_, index): SpotMeterCell => {
    if (index < taken) return "taken";
    return index === taken ? "next" : "left";
  });
}
