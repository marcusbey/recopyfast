import { stripe } from "./config";
import { createClient } from "@/lib/supabase/server";
import {
  getPaidPlan,
  resolveStripePriceId,
  type BillingPeriod,
  type PaidPlanId,
} from "./plans";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import type { Subscription } from "@/types/billing";

/**
 * Statuses that count as "the user currently has this plan". Mirrors the set
 * `getUserSubscription` selects on.
 */
const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

/**
 * Shape actually stored in `billing_subscriptions`. The migration names two
 * columns differently from the `Subscription` TS type (`plan` vs `plan_id`,
 * `cancel_at` timestamp vs `cancel_at_period_end` boolean), so every read goes
 * through `toSubscription` to produce the shape the UI and feature gating
 * expect.
 */
interface SubscriptionRow {
  id: string;
  user_id: string;
  customer_id: string;
  stripe_subscription_id: string;
  plan: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
  canceled_at: string | null;
  trial_start: string | null;
  trial_end: string | null;
  created_at: string;
  updated_at: string;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    ...row,
    plan_id: row.plan as Subscription["plan_id"],
    status: row.status as Subscription["status"],
    cancel_at_period_end: Boolean(row.cancel_at),
    canceled_at: row.canceled_at ?? undefined,
    trial_start: row.trial_start ?? undefined,
    trial_end: row.trial_end ?? undefined,
  };
}

export interface SubscriptionChangeRequest {
  planId: PaidPlanId;
  billingPeriod?: BillingPeriod;
}

export interface SubscriptionChangeResult {
  subscription: Subscription;
  /**
   * True when Stripe could not collect the proration charge without further
   * input (3DS challenge or a declined card). `hostedInvoiceUrl` is where the
   * customer completes it.
   */
  requiresAction: boolean;
  hostedInvoiceUrl: string | null;
}

/**
 * Change the plan on an existing subscription.
 *
 * New subscriptions do NOT go through here — they go through Stripe Checkout
 * (see `./checkout`). This path is only for a customer who already has a live
 * subscription and a payment method on file.
 *
 * `always_invoice` bills the prorated difference immediately rather than
 * deferring it to the next cycle, so an upgrade is paid for at the moment it is
 * granted. If that charge needs a 3DS challenge or the card is declined, Stripe
 * leaves the invoice `open` and we hand the customer its hosted payment page.
 */
export async function updateSubscription(
  userId: string,
  updates: SubscriptionChangeRequest,
): Promise<SubscriptionChangeResult> {
  const supabase = await createClient();

  const { data: currentSubscription, error: fetchError } = await supabase
    .from("billing_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", LIVE_SUBSCRIPTION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .single<SubscriptionRow>();

  if (fetchError || !currentSubscription) {
    throw new Error("No active subscription found");
  }

  const billingPeriod = updates.billingPeriod ?? "monthly";
  // Throws on an unknown plan id, and again if no Stripe price is configured
  // for the plan/period pair — either way before anything is charged.
  await getPaidPlan(updates.planId);
  const priceId = await resolveStripePriceId(updates.planId, billingPeriod);

  const existingSubscription = await stripe.subscriptions.retrieve(
    currentSubscription.stripe_subscription_id,
  );
  const currentItem = existingSubscription.items.data[0];

  if (!currentItem) {
    throw new Error("Subscription has no billable items");
  }

  if (currentItem.price.id === priceId) {
    throw new Error("You are already on this plan");
  }

  const stripeSubscription = await stripe.subscriptions.update(
    currentSubscription.stripe_subscription_id,
    {
      items: [{ id: currentItem.id, price: priceId }],
      proration_behavior: "always_invoice",
      // Keep metadata in sync so webhook-driven writes record the new plan.
      metadata: {
        ...existingSubscription.metadata,
        user_id: userId,
        plan_id: updates.planId,
        billing_period: billingPeriod,
      },
      expand: ["latest_invoice"],
    },
  );

  // An invoice still `open` after the update means Stripe could not collect:
  // either SCA/3DS is required or the card was declined. The hosted invoice
  // page handles both (challenge flow + "use a different card").
  const latestInvoice = stripeSubscription.latest_invoice;
  const openInvoice =
    latestInvoice &&
    typeof latestInvoice === "object" &&
    latestInvoice.status === "open"
      ? latestInvoice
      : null;

  const { data: updatedSubscription, error } = await supabase
    .from("billing_subscriptions")
    .update({
      plan: updates.planId,
      status: stripeSubscription.status,
      current_period_start: new Date(
        (stripeSubscription.items.data[0]?.current_period_start ?? 0) * 1000,
      ).toISOString(),
      current_period_end: new Date(
        (stripeSubscription.items.data[0]?.current_period_end ?? 0) * 1000,
      ).toISOString(),
      cancel_at: stripeSubscription.cancel_at
        ? new Date(stripeSubscription.cancel_at * 1000).toISOString()
        : null,
    })
    .eq("id", currentSubscription.id)
    .select()
    .single<SubscriptionRow>();

  if (error || !updatedSubscription) {
    throw new Error(
      `Failed to update subscription: ${error?.message ?? "unknown error"}`,
    );
  }

  return {
    subscription: toSubscription(updatedSubscription),
    requiresAction: openInvoice !== null,
    hostedInvoiceUrl: openInvoice?.hosted_invoice_url ?? null,
  };
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(
  userId: string,
  immediate: boolean = false,
): Promise<Subscription> {
  const supabase = await createClient();

  // Get current subscription
  const { data: currentSubscription, error: fetchError } = await supabase
    .from("billing_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", LIVE_SUBSCRIPTION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .single<SubscriptionRow>();

  if (fetchError || !currentSubscription) {
    throw new Error("No active subscription found");
  }

  // Cancel subscription in Stripe
  const stripeSubscription = immediate
    ? await stripe.subscriptions.cancel(
        currentSubscription.stripe_subscription_id,
      )
    : await stripe.subscriptions.update(
        currentSubscription.stripe_subscription_id,
        {
          cancel_at_period_end: true,
        },
      );

  // Update subscription in our database
  const { data: updatedSubscription, error } = await supabase
    .from("billing_subscriptions")
    .update({
      status: stripeSubscription.status,
      cancel_at: stripeSubscription.cancel_at
        ? new Date(stripeSubscription.cancel_at * 1000).toISOString()
        : null,
      canceled_at: stripeSubscription.canceled_at
        ? new Date(stripeSubscription.canceled_at * 1000).toISOString()
        : null,
    })
    .eq("id", currentSubscription.id)
    .select()
    .single<SubscriptionRow>();

  if (error || !updatedSubscription) {
    throw new Error(
      `Failed to update subscription: ${error?.message ?? "unknown error"}`,
    );
  }

  return toSubscription(updatedSubscription);
}

/**
 * Reactivate a canceled subscription
 */
export async function reactivateSubscription(
  userId: string,
): Promise<Subscription> {
  const supabase = await createClient();

  // Get current subscription
  const { data: currentSubscription, error: fetchError } = await supabase
    .from("billing_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single<SubscriptionRow>();

  if (fetchError || !currentSubscription) {
    throw new Error("No subscription found");
  }

  if (!currentSubscription.cancel_at) {
    throw new Error("Subscription is not scheduled for cancellation");
  }

  // Reactivate subscription in Stripe
  await stripe.subscriptions.update(
    currentSubscription.stripe_subscription_id,
    {
      cancel_at_period_end: false,
    },
  );

  // Update subscription in our database
  const { data: updatedSubscription, error } = await supabase
    .from("billing_subscriptions")
    .update({
      cancel_at: null,
      canceled_at: null,
    })
    .eq("id", currentSubscription.id)
    .select()
    .single<SubscriptionRow>();

  if (error || !updatedSubscription) {
    throw new Error(
      `Failed to reactivate subscription: ${error?.message ?? "unknown error"}`,
    );
  }

  return toSubscription(updatedSubscription);
}

/**
 * Get user's current subscription, normalised to the `Subscription` shape
 * (`plan_id` / `cancel_at_period_end`) the UI and feature gating read.
 */
export async function getUserSubscription(
  userId: string,
): Promise<Subscription | null> {
  const supabase = await createClient();

  const { data: subscription } = await supabase
    .from("billing_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", LIVE_SUBSCRIPTION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>();

  return subscription ? toSubscription(subscription) : null;
}

/**
 * Check if user has access to a feature based on the plan in force.
 *
 * Resolved through `getEffectivePlan` rather than `billing_subscriptions` alone
 * so a Lifetime Pro customer — who has an entitlement and no subscription — is
 * not gated out. An account with no plan has access to nothing.
 */
export async function checkFeatureAccess(
  userId: string,
  feature:
    | "aiFeatures"
    | "unlimited_websites"
    | "collaborators"
    | "translations",
): Promise<boolean> {
  // Every feature here is plan-shaped — a capability flag or a quota — so
  // purchased credits do not answer any of them.
  const entitlement = await getEffectivePlan(userId);
  if (entitlement.kind !== "plan") {
    return false;
  }
  const { plan } = entitlement;

  switch (feature) {
    case "aiFeatures":
      return plan.limits.aiFeatures;
    case "unlimited_websites":
      return plan.limits.websites === -1;
    case "collaborators":
      return plan.limits.collaborators > 0;
    case "translations":
      return plan.limits.translations !== 0;
    default:
      return false;
  }
}
