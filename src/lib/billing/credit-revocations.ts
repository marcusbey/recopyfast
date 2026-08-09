import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * How many purchased credits a chargeback clawed back, remembered so that
 * winning the dispute puts back exactly those and no more.
 *
 * WHERE — `billing_events`, the billing audit table the Stripe webhook already
 * appends to, under a synthetic `stripe_event_id`. Neither of the two tables
 * involved can hold the number: revocation zeroes `credit_purchases`
 * `credits_remaining`, after which the row cannot tell "700 revoked" from "700
 * spent before the dispute was opened", and `plan_entitlements` has no column
 * free (`source` is the revocation reason, which support reads).
 *
 * The synthetic id carries a `credits_revoked:` prefix, so it cannot collide
 * with the Stripe event ids the route's idempotency probe searches for, and its
 * UNIQUE constraint makes the record idempotent per payment: a redelivered
 * `charge.dispute.created` cannot overwrite the first, truthful amount.
 */
const REVOCATION_EVENT_TYPE = "internal.purchased_credits_revoked";

const UNIQUE_VIOLATION = "23505";

function revocationEventId(stripePaymentIntentId: string): string {
  return `credits_revoked:${stripePaymentIntentId}`;
}

/**
 * Record a clawback about to happen.
 *
 * Called BEFORE the wallet is zeroed, on purpose: if this write fails the
 * webhook 500s with the balance still intact and Stripe's retry starts over,
 * whereas recording afterwards would read a zeroed row on the retry and lose the
 * amount for good.
 */
export async function recordCreditRevocation(
  stripePaymentIntentId: string,
  credits: number,
  reason: string,
  userId: string | null,
): Promise<void> {
  if (!Number.isInteger(credits) || credits <= 0) {
    return;
  }

  const supabase = createServiceRoleClient();

  const { error } = await supabase.from("billing_events").insert({
    user_id: userId,
    event_type: REVOCATION_EVENT_TYPE,
    stripe_event_id: revocationEventId(stripePaymentIntentId),
    data: {
      stripe_payment_intent_id: stripePaymentIntentId,
      credits_revoked: credits,
      reason,
    },
    processed: true,
  });

  // A unique violation means an earlier delivery already recorded this clawback,
  // and its number is the one to keep.
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(
      `Failed to record the credit revocation for ${stripePaymentIntentId}: ${error.message}`,
    );
  }
}

/**
 * How many credits were revoked from this payment, or 0 if nothing was.
 */
export async function readRevokedCredits(
  stripePaymentIntentId: string,
): Promise<number> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("billing_events")
    .select("data")
    .eq("stripe_event_id", revocationEventId(stripePaymentIntentId))
    .maybeSingle<{ data: { credits_revoked?: unknown } | null }>();

  if (error) {
    throw new Error(
      `Failed to read the credit revocation for ${stripePaymentIntentId}: ${error.message}`,
    );
  }

  const credits = data?.data?.credits_revoked;

  return typeof credits === "number" && Number.isInteger(credits) && credits > 0
    ? credits
    : 0;
}
