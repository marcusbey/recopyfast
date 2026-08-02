import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What counts as a spendable purchased credit, and how to total them.
 *
 * Split out of ./system because entitlement resolution needs the same answer:
 * a positive purchased balance is itself an entitlement, so
 * `lib/billing/effective-plan` reads it. Importing ./system there would close a
 * cycle (system → entitlements → effective-plan → system), and duplicating the
 * filter would let the two drift — which for a balance filter means credits
 * that count in one place and not the other.
 */

/**
 * Rows whose credits are still spendable: `expires_at` NULL means never
 * expires, which is what a purchased pack is.
 */
const SPENDABLE = "expires_at.is.null,expires_at.gt.";

/** PostgREST `.or()` filter selecting rows that have not expired as of now. */
export function spendableFilter(): string {
  return `${SPENDABLE}${new Date().toISOString()}`;
}

/**
 * Purchased credits the user can still spend.
 *
 * Throws rather than reporting zero on a read failure. Zero is the answer that
 * decides someone is unentitled and bounces them to the paywall, so it must
 * never be reached by a query that simply did not run.
 */
export async function readPurchasedCreditBalance(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("credit_purchases")
    .select("credits_remaining")
    .eq("user_id", userId)
    .gt("credits_remaining", 0)
    .or(spendableFilter());

  if (error) {
    throw new Error(`credit_purchases read failed: ${error.message}`);
  }

  return (
    (data as { credits_remaining: number | null }[] | null)?.reduce(
      (sum, purchase) => sum + (purchase.credits_remaining || 0),
      0,
    ) ?? 0
  );
}
