import { stripe, SUBSCRIPTION_PLANS } from "./config";
import { createClient } from "@/lib/supabase/server";
import { createOrGetCustomer } from "./customer";
import type { Subscription, SubscriptionUpdateRequest } from "@/types/billing";

/**
 * Create a new subscription.
 * Trial period is NOT taken from the client request — it is derived server-side
 * from plan config (currently 0 for all paid plans; extend SUBSCRIPTION_PLANS if
 * you want per-plan trials).
 */
export async function createSubscription(
  userId: string,
  email: string,
  planId: "starter" | "pro" | "enterprise",
  paymentMethodId?: string,
): Promise<{ subscription: Subscription; clientSecret?: string }> {
  const supabase = await createClient();

  const plan =
    SUBSCRIPTION_PLANS[planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
  if (!plan.priceId) {
    throw new Error("Invalid plan selected");
  }

  // Create or get customer
  const { customer, stripeCustomer } = await createOrGetCustomer(userId, email);

  // Attach payment method if provided
  if (paymentMethodId) {
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: stripeCustomer.id,
    });

    // Set as default payment method
    await stripe.customers.update(stripeCustomer.id, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  // Create subscription in Stripe — trial days are derived server-side only.
  // Currently all plans have 0 trial days; add a trialDays field to
  // SUBSCRIPTION_PLANS config if per-plan trials are needed.
  const subscriptionParams: import("stripe").Stripe.SubscriptionCreateParams = {
    customer: stripeCustomer.id,
    items: [{ price: plan.priceId }],
    metadata: {
      user_id: userId,
      plan_id: planId,
    },
  };

  // If no payment method, require payment confirmation
  if (!paymentMethodId) {
    subscriptionParams.payment_behavior = "default_incomplete";
    subscriptionParams.payment_settings = {
      save_default_payment_method: "on_subscription",
    };
    subscriptionParams.expand = ["latest_invoice.payment_intent"];
  }

  const stripeSubscription =
    await stripe.subscriptions.create(subscriptionParams);

  // Save subscription to our database.
  // Column mapping (migration → code):
  //   plan           (not plan_id)
  //   cancel_at      (not cancel_at_period_end; migration stores the timestamp)
  const { data: newSubscription, error } = await supabase
    .from("billing_subscriptions")
    .insert({
      user_id: userId,
      customer_id: customer.id,
      stripe_subscription_id: stripeSubscription.id,
      plan: planId,
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
      trial_start: stripeSubscription.trial_start
        ? new Date(stripeSubscription.trial_start * 1000).toISOString()
        : null,
      trial_end: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000).toISOString()
        : null,
    })
    .select()
    .single();

  if (error) {
    // Rollback: cancel the Stripe subscription
    await stripe.subscriptions.cancel(stripeSubscription.id);
    throw new Error(`Failed to create subscription: ${error.message}`);
  }

  // Extract client secret if payment confirmation is needed
  let clientSecret: string | undefined;
  if (
    stripeSubscription.latest_invoice &&
    typeof stripeSubscription.latest_invoice === "object"
  ) {
    const latestInvoice =
      stripeSubscription.latest_invoice as unknown as Record<string, unknown>;
    const paymentIntent = latestInvoice?.payment_intent as
      | { client_secret?: string | null }
      | null
      | undefined;
    if (paymentIntent && typeof paymentIntent === "object") {
      clientSecret = paymentIntent.client_secret ?? undefined;
    }
  }

  return { subscription: newSubscription as Subscription, clientSecret };
}

/**
 * Update an existing subscription
 */
export async function updateSubscription(
  userId: string,
  updates: SubscriptionUpdateRequest,
): Promise<Subscription> {
  const supabase = await createClient();

  // Get current subscription
  const { data: currentSubscription, error: fetchError } = await supabase
    .from("billing_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .single();

  if (fetchError || !currentSubscription) {
    throw new Error("No active subscription found");
  }

  const plan =
    SUBSCRIPTION_PLANS[
      updates.planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS
    ];
  if (!plan.priceId) {
    throw new Error("Invalid plan selected");
  }

  // Update payment method if provided
  if (updates.paymentMethodId) {
    const { data: customer } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("id", currentSubscription.customer_id)
      .single();

    if (customer) {
      await stripe.paymentMethods.attach(updates.paymentMethodId, {
        customer: customer.stripe_customer_id,
      });

      await stripe.customers.update(customer.stripe_customer_id, {
        invoice_settings: {
          default_payment_method: updates.paymentMethodId,
        },
      });
    }
  }

  // Update subscription in Stripe
  const existingSubscription = await stripe.subscriptions.retrieve(
    currentSubscription.stripe_subscription_id,
  );
  const stripeSubscription = await stripe.subscriptions.update(
    currentSubscription.stripe_subscription_id,
    {
      items: [
        {
          id: existingSubscription.items.data[0].id,
          price: plan.priceId,
        },
      ],
      proration_behavior: "create_prorations",
      metadata: {
        plan_id: updates.planId,
      },
    },
  );

  // Update subscription in our database
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
    .single();

  if (error) {
    throw new Error(`Failed to update subscription: ${error.message}`);
  }

  return updatedSubscription as Subscription;
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
    .eq("status", "active")
    .single();

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
    .single();

  if (error) {
    throw new Error(`Failed to update subscription: ${error.message}`);
  }

  return updatedSubscription as Subscription;
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
    .single();

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
    .single();

  if (error) {
    throw new Error(`Failed to reactivate subscription: ${error.message}`);
  }

  return updatedSubscription as Subscription;
}

/**
 * Get user's current subscription
 */
export async function getUserSubscription(
  userId: string,
): Promise<Subscription | null> {
  const supabase = await createClient();

  const { data: subscription } = await supabase
    .from("billing_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return subscription as Subscription | null;
}

/**
 * Check if user has access to a feature based on their subscription
 */
export async function checkFeatureAccess(
  userId: string,
  feature:
    | "aiFeatures"
    | "unlimited_websites"
    | "collaborators"
    | "translations",
): Promise<boolean> {
  const subscription = await getUserSubscription(userId);

  if (!subscription) {
    // User has no subscription - no access to paid features
    return (
      feature !== "aiFeatures" &&
      feature !== "unlimited_websites" &&
      feature !== "collaborators" &&
      feature !== "translations"
    );
  }

  // The DB column is `plan`; the TS type declares it as `plan_id` (legacy mismatch).
  // At runtime the object returned from Supabase carries the actual DB column name.
  const planKey = (
    (subscription as unknown as { plan?: string }).plan ?? subscription.plan_id
  ).toUpperCase() as keyof typeof SUBSCRIPTION_PLANS;

  const plan = SUBSCRIPTION_PLANS[planKey];

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
