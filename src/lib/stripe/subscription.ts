import { stripe, SUBSCRIPTION_PLANS } from './config';
import { createClient } from '@/lib/supabase/server';
import { createOrGetCustomer } from './customer';
import type { Subscription, SubscriptionUpdateRequest } from '@/types/billing';

/**
 * Create a new subscription
 */
export async function createSubscription(
  userId: string,
  email: string,
  planId: 'pro' | 'enterprise',
  paymentMethodId?: string,
  trialDays?: number
): Promise<{ subscription: Subscription; clientSecret?: string }> {
  const supabase = await createClient();
  
  const plan = SUBSCRIPTION_PLANS[planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
  if (!plan.priceId) {
    throw new Error('Invalid plan selected');
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

  // Create subscription in Stripe
  const subscriptionParams: import('stripe').Stripe.SubscriptionCreateParams = {
    customer: stripeCustomer.id,
    items: [{ price: plan.priceId }],
    metadata: {
      user_id: userId,
      plan_id: planId,
    },
  };

  // Add trial if specified
  if (trialDays) {
    subscriptionParams.trial_period_days = trialDays;
  }

  // If no payment method, require payment confirmation
  if (!paymentMethodId) {
    subscriptionParams.payment_behavior = 'default_incomplete';
    subscriptionParams.payment_settings = {
      save_default_payment_method: 'on_subscription',
    };
    subscriptionParams.expand = ['latest_invoice.payment_intent'];
  }

  const stripeSubscription = await stripe.subscriptions.create(subscriptionParams);

  // Save subscription to our database
  const { data: newSubscription, error } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userId,
      customer_id: customer.id,
      stripe_subscription_id: stripeSubscription.id,
      plan_id: planId,
      status: stripeSubscription.status,
      current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: stripeSubscription.cancel_at_period_end,
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
  if (stripeSubscription.latest_invoice && typeof stripeSubscription.latest_invoice === 'object') {
    const paymentIntent = stripeSubscription.latest_invoice.payment_intent;
    if (paymentIntent && typeof paymentIntent === 'object') {
      clientSecret = paymentIntent.client_secret;
    }
  }

  return { subscription: newSubscription, clientSecret };
}

/**
 * Update an existing subscription
 */
export async function updateSubscription(
  userId: string,
  updates: SubscriptionUpdateRequest
): Promise<Subscription> {
  const supabase = await createClient();

  // Get current subscription
  const { data: currentSubscription, error: fetchError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (fetchError || !currentSubscription) {
    throw new Error('No active subscription found');
  }

  const plan = SUBSCRIPTION_PLANS[updates.planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
  if (!plan.priceId) {
    throw new Error('Invalid plan selected');
  }

  // Update payment method if provided
  if (updates.paymentMethodId) {
    const { data: customer } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('id', currentSubscription.customer_id)
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
  const existingSubscription = await stripe.subscriptions.retrieve(currentSubscription.stripe_subscription_id);
  const stripeSubscription = await stripe.subscriptions.update(
    currentSubscription.stripe_subscription_id,
    {
      items: [
        {
          id: existingSubscription.items.data[0].id,
          price: plan.priceId,
        },
      ],
      proration_behavior: 'create_prorations',
      metadata: {
        plan_id: updates.planId,
      },
    }
  );

  // Update subscription in our database
  const { data: updatedSubscription, error } = await supabase
    .from('subscriptions')
    .update({
      plan_id: updates.planId,
      status: stripeSubscription.status,
      current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: stripeSubscription.cancel_at_period_end,
    })
    .eq('id', currentSubscription.id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update subscription: ${error.message}`);
  }

  return updatedSubscription;
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(
  userId: string,
  immediate: boolean = false
): Promise<Subscription> {
  const supabase = await createClient();

  // Get current subscription
  const { data: currentSubscription, error: fetchError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (fetchError || !currentSubscription) {
    throw new Error('No active subscription found');
  }

  // Cancel subscription in Stripe
  const stripeSubscription = immediate
    ? await stripe.subscriptions.cancel(currentSubscription.stripe_subscription_id)
    : await stripe.subscriptions.update(currentSubscription.stripe_subscription_id, {
        cancel_at_period_end: true,
      });

  // Update subscription in our database
  const { data: updatedSubscription, error } = await supabase
    .from('subscriptions')
    .update({
      status: stripeSubscription.status,
      cancel_at_period_end: stripeSubscription.cancel_at_period_end,
      canceled_at: stripeSubscription.canceled_at 
        ? new Date(stripeSubscription.canceled_at * 1000).toISOString() 
        : null,
    })
    .eq('id', currentSubscription.id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update subscription: ${error.message}`);
  }

  return updatedSubscription;
}

/**
 * Reactivate a canceled subscription
 */
export async function reactivateSubscription(userId: string): Promise<Subscription> {
  const supabase = await createClient();

  // Get current subscription
  const { data: currentSubscription, error: fetchError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (fetchError || !currentSubscription) {
    throw new Error('No subscription found');
  }

  if (!currentSubscription.cancel_at_period_end) {
    throw new Error('Subscription is not scheduled for cancellation');
  }

  // Reactivate subscription in Stripe
  await stripe.subscriptions.update(
    currentSubscription.stripe_subscription_id,
    {
      cancel_at_period_end: false,
    }
  );

  // Update subscription in our database
  const { data: updatedSubscription, error } = await supabase
    .from('subscriptions')
    .update({
      cancel_at_period_end: false,
      canceled_at: null,
    })
    .eq('id', currentSubscription.id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to reactivate subscription: ${error.message}`);
  }

  return updatedSubscription;
}

/**
 * Get user's current subscription
 */
export async function getUserSubscription(userId: string): Promise<Subscription | null> {
  const supabase = await createClient();

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return subscription;
}

/**
 * Check if user has access to a feature based on their subscription
 */
export async function checkFeatureAccess(
  userId: string,
  feature: 'aiFeatures' | 'unlimited_websites' | 'collaborators' | 'translations'
): Promise<boolean> {
  const subscription = await getUserSubscription(userId);
  
  if (!subscription) {
    // User has no subscription, check free tier limits
    const freePlan = SUBSCRIPTION_PLANS.FREE;
    return freePlan.limits.aiFeatures && feature === 'aiFeatures' ? false : true;
  }

  const plan = SUBSCRIPTION_PLANS[subscription.plan_id.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
  
  switch (feature) {
    case 'aiFeatures':
      return plan.limits.aiFeatures;
    case 'unlimited_websites':
      return plan.limits.websites === -1;
    case 'collaborators':
      return plan.limits.collaborators > 0;
    case 'translations':
      return plan.limits.translations !== 0;
    default:
      return false;
  }
}