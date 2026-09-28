import { createServiceRoleClient } from "@/lib/supabase/service";
import type { FoundingOfferId } from "@/types/billing";

/**
 * The founding offer: the first 20 accounts get Pro free for 90 days, metered
 * at 100 AI credits a month, no card (s47a, ADR 039).
 *
 * The grant is the account's one trial row, written by
 * `claim_founding_offer_spot` (20260928120000_founding_offer.sql) together with
 * its claim, under the offer's own advisory lock. Each number lives once:
 *
 *   20 spots, 90 days — SQL constants in the claim function, where the grant is
 *                        written on the database clock. Availability returns
 *                        `spot_limit`, so nothing here restates 20.
 *   100 credits/month — `FOUNDING_OFFER_TERMS` below, read by the resolver. An
 *                        allowance term like `TRIAL_DURATION_DAYS` (ADR 014),
 *                        not a catalogue product: a second product granting
 *                        `pro` makes `loadPlanCatalogue` throw.
 */

export const FOUNDING_OFFER_ID: FoundingOfferId = "founding_20";

export interface FoundingOfferTerms {
  /** Replaces Pro's allowance while the offer row alone confers `pro`. */
  readonly monthlyCredits: number;
}

export const FOUNDING_OFFER_TERMS: Readonly<
  Record<FoundingOfferId, FoundingOfferTerms>
> = {
  founding_20: { monthlyCredits: 100 },
};

/**
 * An `offer_id` read off a row is only an offer this code has terms for.
 * `Object.hasOwn`, so `__proto__` or `constructor` never resolve to terms.
 */
export function isFoundingOfferId(value: unknown): value is FoundingOfferId {
  return (
    typeof value === "string" && Object.hasOwn(FOUNDING_OFFER_TERMS, value)
  );
}

export type FoundingOfferClaim =
  | { outcome: "claimed"; entitlementId: string; expiresAt: string }
  | { outcome: "sold_out" | "ineligible" };

export interface FoundingOfferAvailability {
  limit: number;
  remaining: number;
  soldOut: boolean;
}

interface ClaimRow {
  outcome: unknown;
  entitlement_id: unknown;
  expires_at: unknown;
}

interface AvailabilityRow {
  spot_limit: unknown;
  remaining: unknown;
  sold_out: unknown;
}

function rpcError(operation: string, message: string): Error {
  return new Error(`Failed to ${operation} the founding offer: ${message}`);
}

/**
 * Try to claim a spot for an account signing in with no plan.
 *
 * Throws on anything it cannot read as one of the three outcomes. The caller
 * (`ensureTrialStarted`) treats a throw exactly like `sold_out`: it falls back
 * to the 14-day trial, and the one-trial index settles the rest.
 */
export async function claimFoundingOfferSpot(
  userId: string,
): Promise<FoundingOfferClaim> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("claim_founding_offer_spot", {
    p_user_id: userId,
  });

  if (error) throw rpcError("claim", error.message);
  const row = (data as ClaimRow[] | null)?.[0];
  if (!row) throw rpcError("claim", "the claim RPC returned no row");

  if (
    row.outcome === "claimed" &&
    typeof row.entitlement_id === "string" &&
    typeof row.expires_at === "string"
  ) {
    return {
      outcome: "claimed",
      entitlementId: row.entitlement_id,
      expiresAt: row.expires_at,
    };
  }
  if (row.outcome === "sold_out" || row.outcome === "ineligible") {
    return { outcome: row.outcome };
  }
  throw rpcError("claim", "the claim RPC returned an invalid result");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Public-safe aggregate: how many spots are left, never who took them.
 *
 * A row outside the offer's own bounds is an error, not a number: the landing
 * page shows the 14-day trial line when this throws, and must never show a
 * guessed count.
 */
export async function getFoundingOfferAvailability(): Promise<FoundingOfferAvailability> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("get_founding_offer_availability");

  if (error) throw rpcError("read", error.message);
  const row = (data as AvailabilityRow[] | null)?.[0];
  if (!row) throw rpcError("read", "the availability RPC returned no row");

  const { spot_limit: limit, remaining, sold_out: soldOut } = row;
  if (
    !isNonNegativeInteger(limit) ||
    limit === 0 ||
    !isNonNegativeInteger(remaining) ||
    remaining > limit ||
    typeof soldOut !== "boolean" ||
    soldOut !== (remaining === 0)
  ) {
    throw rpcError("read", "the availability RPC returned an invalid result");
  }

  return { limit, remaining, soldOut };
}
