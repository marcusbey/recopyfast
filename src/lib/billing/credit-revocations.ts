import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * How many purchased credits a chargeback clawed back, remembered so that
 * winning that dispute puts back exactly those and no more.
 *
 * WHERE — `billing_events`, the billing audit table the Stripe webhook already
 * appends to, under a synthetic `stripe_event_id`. Neither of the two tables
 * involved can hold the number: revocation zeroes `credit_purchases`
 * `credits_remaining`, after which the row cannot tell "700 revoked" from "700
 * spent before the dispute was opened", and `plan_entitlements` has no column
 * free (`source` is the revocation reason, which support reads).
 *
 * KEYED PER DISPUTE, not per payment. One payment can be disputed more than
 * once — a first chargeback won, the customer spends some of the restored
 * balance, then a second chargeback is filed — and each dispute claws back a
 * different amount. Keying per payment made the second dispute reuse the first
 * one's number: 1,000 revoked and restored, 600 spent, 400 revoked, and winning
 * again handed back 1,000. `credits_purchased` does not cap that away, because
 * 1,000 is what the pack held.
 *
 * The synthetic id carries a `credits_revoked:` prefix, so it cannot collide
 * with the Stripe event ids the route's idempotency probe searches for, and its
 * UNIQUE constraint still makes each dispute's record write-once: a redelivered
 * `charge.dispute.created` cannot overwrite the first, truthful amount.
 */
const REVOCATION_EVENT_TYPE = "internal.purchased_credits_revoked";

const UNIQUE_VIOLATION = "23505";

function revocationEventId(stripeDisputeId: string): string {
  return `credits_revoked:${stripeDisputeId}`;
}

export interface CreditRevocation {
  /** The dispute this clawback belongs to — the key. */
  stripeDisputeId: string;
  stripePaymentIntentId: string;
  /** Balance being taken away, which is the balance to return to on a win. */
  credits: number;
  userId: string | null;
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
  revocation: CreditRevocation,
): Promise<void> {
  const { stripeDisputeId, stripePaymentIntentId, credits, userId } =
    revocation;

  if (!Number.isInteger(credits) || credits <= 0) {
    return;
  }

  const supabase = createServiceRoleClient();

  const { error } = await supabase.from("billing_events").insert({
    user_id: userId,
    event_type: REVOCATION_EVENT_TYPE,
    stripe_event_id: revocationEventId(stripeDisputeId),
    data: {
      stripe_dispute_id: stripeDisputeId,
      stripe_payment_intent_id: stripePaymentIntentId,
      credits_revoked: credits,
    },
    processed: true,
  });

  // A unique violation means an earlier delivery of this same dispute already
  // recorded the clawback, and its number is the one to keep.
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(
      `Failed to record the credit revocation for dispute ${stripeDisputeId}: ${error.message}`,
    );
  }
}

/**
 * How many credits this dispute revoked, or 0 if it revoked none.
 */
export async function readRevokedCredits(
  stripeDisputeId: string,
): Promise<number> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("billing_events")
    .select("data")
    .eq("stripe_event_id", revocationEventId(stripeDisputeId))
    .maybeSingle<{ data: { credits_revoked?: unknown } | null }>();

  if (error) {
    throw new Error(
      `Failed to read the credit revocation for dispute ${stripeDisputeId}: ${error.message}`,
    );
  }

  const credits = data?.data?.credits_revoked;

  return typeof credits === "number" && Number.isInteger(credits) && credits > 0
    ? credits
    : 0;
}
