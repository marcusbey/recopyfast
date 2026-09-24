import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingPeriod, PaidPlanId } from "@/lib/stripe/plans";

// Stripe refuses Checkout `expires_at` values under 30 minutes. The intent gets
// a full hour so ordinary retries retain enough headroom, while the route stops
// retrying an ambiguous creation once that floor is reached. Releasing it at
// 30 minutes would recreate the exact duplicate-payable-session window this guard
// exists to close: Stripe may have accepted a response we never received.
export const SUBSCRIPTION_CHECKOUT_TTL_MS = 60 * 60 * 1000;
export const STRIPE_CHECKOUT_MIN_EXPIRY_MS = 30 * 60 * 1000;

export interface SubscriptionCheckoutIntent {
  id: string;
  userId: string;
  stripeSessionId: string | null;
  checkoutUrl: string | null;
  stripePriceId: string | null;
  planId: PaidPlanId | null;
  billingPeriod: BillingPeriod | null;
  expiresAt: string;
  isNew: boolean;
}

interface IntentRow {
  id: string;
  user_id: string;
  stripe_session_id: string | null;
  checkout_url: string | null;
  stripe_price_id: string | null;
  plan_id: PaidPlanId | null;
  billing_period: BillingPeriod | null;
  expires_at: string;
  is_new: boolean;
}

export class ExistingSubscriptionBlocksCheckoutError extends Error {}

function oneRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

/**
 * Atomically returns the user's pending intent or creates one through a
 * service-only RPC. Browser roles deliberately have no delete permission:
 * deleting this row would turn the duplicate-charge guard into an opt-out.
 */
export async function claimSubscriptionCheckoutIntent(
  supabase: SupabaseClient,
  userId: string,
  choice: {
    stripePriceId: string;
    planId: PaidPlanId;
    billingPeriod: BillingPeriod;
  },
  expiresAt = new Date(Date.now() + SUBSCRIPTION_CHECKOUT_TTL_MS).toISOString(),
): Promise<SubscriptionCheckoutIntent> {
  const { data, error } = await supabase.rpc(
    "claim_subscription_checkout_intent",
    {
      p_user_id: userId,
      p_expires_at: expiresAt,
      p_stripe_price_id: choice.stripePriceId,
      p_plan_id: choice.planId,
      p_billing_period: choice.billingPeriod,
    },
  );
  if (
    error?.code === "P0001" &&
    error.message.includes("non-terminal subscription")
  ) {
    throw new ExistingSubscriptionBlocksCheckoutError(error.message);
  }
  if (error)
    throw new Error(`Failed to claim checkout intent: ${error.message}`);

  const row = oneRow(data as IntentRow | IntentRow[] | null);
  if (!row) throw new Error("Failed to claim checkout intent: no row returned");

  return {
    id: row.id,
    userId: row.user_id,
    stripeSessionId: row.stripe_session_id,
    checkoutUrl: row.checkout_url,
    stripePriceId: row.stripe_price_id,
    planId: row.plan_id,
    billingPeriod: row.billing_period,
    expiresAt: row.expires_at,
    isNew: row.is_new,
  };
}

export async function attachCheckoutSession(
  supabase: SupabaseClient,
  intentId: string,
  userId: string,
  session: { sessionId: string; url: string | null },
  options: { ignoreMissingIntent?: boolean } = {},
): Promise<boolean> {
  const { error } = await supabase.rpc("attach_subscription_checkout_session", {
    p_intent_id: intentId,
    p_user_id: userId,
    p_stripe_session_id: session.sessionId,
    p_checkout_url: session.url,
  });
  if (error && options.ignoreMissingIntent && error.code === "P0002") {
    return false;
  }
  if (error)
    throw new Error(`Failed to persist checkout session: ${error.message}`);
  return true;
}

export async function finishSubscriptionCheckoutIntent(
  supabase: SupabaseClient,
  intentId: string,
  sessionId: string,
  status: "completed" | "expired",
): Promise<void> {
  const { error } = await supabase.rpc("finish_subscription_checkout_intent", {
    p_intent_id: intentId,
    p_stripe_session_id: sessionId,
    p_status: status,
  });
  if (error)
    throw new Error(`Failed to finish checkout intent: ${error.message}`);
}

/**
 * Release an unattached intent only after its fixed expiry has passed and a
 * paginated Stripe lookup proves no session carries this intent's metadata.
 * Ambiguous provider errors stay pending.
 */
export async function expireUnattachedSubscriptionCheckoutIntent(
  supabase: SupabaseClient,
  intentId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase.rpc(
    "expire_unattached_subscription_checkout_intent",
    { p_intent_id: intentId, p_user_id: userId },
  );
  if (error)
    throw new Error(`Failed to expire checkout intent: ${error.message}`);
}
