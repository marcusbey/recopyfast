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

/**
 * The payment-intent prefix of a credit row that no one paid for.
 *
 * Before s48 every AI refund minted a never-expiring `credit_purchases` row
 * keyed `refund_<reason>_<user>_…` (its only writer was the old owner-keyed
 * refund). Any positive purchased balance entitles its holder, so one
 * refunded failure kept a lapsed, never-paying trial past the paywall (probe
 * P3), and each one added to "Total purchased". Refunds now return credits to
 * their source (`refund_credit_usage`) and never write a row.
 *
 * Existing rows are left alone and stay SPENDABLE: the source of those charges
 * was never recorded, so nobody can tell which of them made up for paid
 * credits, and zeroing them could take away value someone paid for. They only
 * stop counting as an entitlement and as a purchase.
 *
 * Keyed on the prefix, NEVER on `price_cents = 0`: `migrated_wallet_` rows
 * (20260802020000_…sql:119-130) are paid wallets carried over at price 0, and a
 * price-based test would bounce their holders to the paywall.
 */
export const LEGACY_REFUND_PAYMENT_PREFIX = "refund_";

/** A row the old refund minted. NULL is a paid row (older packs, before the column was filled). */
export function isLegacyRefundGrant(paymentIntentId: string | null): boolean {
  return (
    paymentIntentId !== null &&
    paymentIntentId.startsWith(LEGACY_REFUND_PAYMENT_PREFIX)
  );
}

/**
 * Spendable purchased credits that were paid for — what entitles an account
 * with no plan.
 *
 * The legacy rows are dropped here, in TypeScript, rather than with a PostgREST
 * `not.like` filter: `_` is a LIKE wildcard, and a NULL payment intent would
 * drop out of any comparison, losing exactly the rows that count as paid.
 *
 * Throws on a read failure for the same reason `readPurchasedCreditBalance`
 * does: zero decides someone is unentitled.
 */
export async function readPaidCreditBalance(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("credit_purchases")
    .select("credits_remaining, stripe_payment_intent_id")
    .eq("user_id", userId)
    .gt("credits_remaining", 0)
    .or(spendableFilter());

  if (error) {
    throw new Error(`credit_purchases read failed: ${error.message}`);
  }

  return (
    (
      data as
        | {
            credits_remaining: number | null;
            stripe_payment_intent_id: string | null;
          }[]
        | null
    )
      ?.filter(
        (purchase) =>
          !isLegacyRefundGrant(purchase.stripe_payment_intent_id ?? null),
      )
      .reduce((sum, purchase) => sum + (purchase.credits_remaining || 0), 0) ??
    0
  );
}
