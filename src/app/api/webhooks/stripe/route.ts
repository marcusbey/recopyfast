import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import type Stripe from "stripe";
import { stripe, requireWebhookSecret } from "@/lib/stripe/config";
import { isPaidPlanId, resolveStripePriceId } from "@/lib/stripe/plans";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  addPurchasedCredits,
  revokePurchasedCredits,
} from "@/lib/credits/system";
import {
  grantPlanEntitlement,
  revokeEntitlementForPayment,
} from "@/lib/billing/entitlements";

// The Stripe SDK types for the 2025-07-30.basil API version (what
// STRIPE_CONFIG.API_VERSION pins) removed current_period_start /
// current_period_end from the top-level Subscription object — they now live on
// each SubscriptionItem.
//
// Whether a given webhook payload still carries them at the top level depends
// on the API version configured on the *endpoint* in the Stripe dashboard,
// which is set outside this repo and can differ from the pinned SDK version.
// So the fields are typed OPTIONAL here: asserting them as `number` made `tsc`
// pass while `new Date(undefined * 1000)` threw RangeError at runtime, 500ing
// the webhook. Stripe then retries forever and no subscription ever reconciles
// — payment succeeds but the customer is never provisioned.
type StripeSubscriptionWithPeriod = Stripe.Subscription & {
  current_period_start?: number;
  current_period_end?: number;
};

/**
 * Pick the subscription item whose billing period represents this subscription.
 *
 * Stripe moved the period onto SubscriptionItem precisely because items on one
 * subscription CAN bill on different cycles (e.g. a monthly item alongside a
 * yearly one), so blindly taking items.data[0] would record the wrong boundary.
 *
 * `billing_subscriptions` stores a single period, and createCheckoutSession
 * only ever builds a one-line-item subscription — so a single item is the
 * expected case. A multi-item subscription can still arrive from a manual edit
 * in the Stripe dashboard; resolve it by matching the plan recorded in
 * metadata, and refuse to guess if that fails.
 */
async function resolvePeriodItem(
  subscription: StripeSubscriptionWithPeriod,
): Promise<Stripe.SubscriptionItem | undefined> {
  const items = subscription.items?.data ?? [];

  if (items.length <= 1) return items[0];

  const planId = subscription.metadata?.plan_id;
  const candidatePriceIds: readonly string[] = isPaidPlanId(planId)
    ? await Promise.all([
        resolveStripePriceId(planId, "monthly"),
        resolveStripePriceId(planId, "yearly"),
      ])
    : [];

  const matches = items.filter((item) =>
    candidatePriceIds.includes(item.price?.id),
  );

  if (matches.length === 1) return matches[0];

  throw new Error(
    `Stripe subscription ${subscription.id} has ${items.length} items and ` +
      `${matches.length} match plan "${planId ?? "unknown"}". billing_subscriptions ` +
      `stores one billing period, so the correct item is ambiguous. Resolve the ` +
      `subscription in Stripe, or extend the schema to store a period per item.`,
  );
}

/**
 * Read a billing-period boundary from whichever shape this payload uses:
 * the subscription item (current API versions) or the top level (older ones).
 *
 * Throws rather than emitting an invalid date — a loud failure that Stripe
 * retries is recoverable; silently writing a bogus period is not.
 */
async function subscriptionPeriod(
  subscription: StripeSubscriptionWithPeriod,
  boundary: "start" | "end",
): Promise<string> {
  const key = `current_period_${boundary}` as const;
  const epochSeconds =
    (await resolvePeriodItem(subscription))?.[key] ?? subscription[key];

  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) {
    throw new Error(
      `Stripe subscription ${subscription.id} has no ${key} on either the ` +
        `subscription item or the top-level object. Check the API version ` +
        `configured on the webhook endpoint.`,
    );
  }

  return new Date(epochSeconds * 1000).toISOString();
}

// Similarly, Invoice.subscription was moved under
// Invoice.parent.subscription_details.subscription in newer API versions,
// but the webhook payload still includes a top-level `subscription` field.
type StripeInvoiceWithSubscription = Stripe.Invoice & {
  subscription: string | Stripe.Subscription | null;
};

// Minimal shape of event data objects that carry metadata + customer.
// Used only inside logBillingEvent to avoid operating on the full
// Stripe.Event.data.object union (which is 70+ types).
type BillingEventObject = {
  metadata?: Record<string, string> | null;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
};

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature") as string;

  let event: Stripe.Event;

  // Fail closed on a missing/empty signing secret BEFORE attempting to verify.
  // constructEvent happily accepts "" as an HMAC key, so without this an unset
  // variable would silently authenticate every caller rather than reject them.
  // 500 rather than 400: the request may be perfectly valid — the server is the
  // thing that is broken — and 5xx makes Stripe retry once the secret is set.
  let webhookSecret: string;
  try {
    webhookSecret = requireWebhookSecret();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Stripe webhook misconfigured:", message);
    return NextResponse.json(
      { error: "Webhook signing secret is not configured" },
      { status: 500 },
    );
  }

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Webhook signature verification failed:", message);
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 400 },
    );
  }

  // Use service-role client so RLS does not block webhook DB writes.
  const supabase = createServiceRoleClient();

  // Idempotency guard: short-circuit if this Stripe event was already processed.
  const { data: existingEvent, error: idempotencyError } = await supabase
    .from("billing_events")
    .select("id")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (idempotencyError) {
    console.error("Idempotency check failed:", idempotencyError.message);
    return NextResponse.json(
      { error: "Webhook idempotency check failed" },
      { status: 500 },
    );
  } else if (existingEvent) {
    console.log(
      `Stripe event ${event.id} already processed — skipping (idempotent).`,
    );
    return NextResponse.json({ received: true, duplicate: true });
  }

  console.log("Processing Stripe webhook:", event.type);

  try {
    switch (event.type) {
      case "customer.subscription.created":
        await handleSubscriptionCreated(
          event.data.object as StripeSubscriptionWithPeriod,
          supabase,
        );
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as StripeSubscriptionWithPeriod,
          supabase,
        );
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object, supabase);
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(
          event.data.object as StripeInvoiceWithSubscription,
          supabase,
        );
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(
          event.data.object as StripeInvoiceWithSubscription,
          supabase,
        );
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;

      case "charge.refunded":
        await handleMoneyReturned(event.data.object, "refund");
        break;

      case "charge.dispute.created":
        await handleMoneyReturned(event.data.object, "dispute");
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object);
        break;

      case "customer.created":
        await handleCustomerCreated(event.data.object);
        break;

      case "customer.updated":
        await handleCustomerUpdated(event.data.object, supabase);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Log the event for audit trail
    await logBillingEvent(event, supabase);

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    // A unique-violation means a concurrent delivery already processed this
    // event. Return 200 so Stripe stops retrying — the work is already done.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "23505"
    ) {
      console.log(
        `Stripe event ${event.id} hit a unique-violation — already processed concurrently.`,
      );
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("Error processing webhook:", error);
    return NextResponse.json(
      { error: "Error processing webhook" },
      { status: 500 },
    );
  }
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/** Stripe expands references inconsistently; normalise to an id. */
function idOf(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Turn a supabase-js `{ error }` into a throw.
 *
 * WHY — supabase-js RESOLVES on failure; it does not reject. Every write in
 * this file used to be `await supabase.from(...).upsert(...)` with the result
 * discarded, so a failed write was indistinguishable from a successful one and
 * the handler went on to return `{ received: true }` with HTTP 200. Stripe
 * treats 2xx as "delivered", stops retrying, and the event is gone: the card is
 * charged, the row never lands, and nothing alerts. That is silent revenue loss.
 *
 * Throwing routes the failure into the POST handler's catch, which returns 500
 * and lets Stripe redeliver on its own retry schedule.
 *
 * The Postgres error `code` is preserved on the thrown Error because the catch
 * block keys on `23505` (unique violation) to recognise a concurrent duplicate
 * delivery and answer 200 instead of 500.
 */
function assertWritten(
  error: { code?: string; message?: string; details?: string } | null,
  operation: string,
): void {
  if (!error) return;

  const failure = new Error(
    `${operation} failed: ${error.message ?? "unknown error"}` +
      (error.details ? ` (${error.details})` : ""),
  ) as Error & { code?: string };
  failure.code = error.code;
  throw failure;
}

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreated(
  subscription: StripeSubscriptionWithPeriod,
  supabase: ServiceClient,
) {
  // A subscription created from the Stripe dashboard or a Payment Link carries
  // no metadata, so fall back to the customer record before giving up.
  const customer = await requireBillingCustomer(
    subscription.customer,
    supabase,
  );
  const userId = subscription.metadata?.user_id ?? customer.user_id;

  // Insert or update subscription — use actual migration column names:
  // plan (not plan_id), cancel_at (not cancel_at_period_end)
  //
  // onConflict MUST name stripe_subscription_id. Without it PostgREST resolves
  // the conflict against the primary key, which is a generated UUID that never
  // collides — so this was always a plain INSERT, and a redelivered event hit
  // the UNIQUE constraint on stripe_subscription_id instead of updating the row.
  const { error: subscriptionError } = await supabase
    .from("billing_subscriptions")
    .upsert(
      {
        user_id: userId,
        customer_id: customer.id,
        stripe_subscription_id: subscription.id,
        plan: subscription.metadata?.plan_id || "pro",
        status: subscription.status,
        current_period_start: await subscriptionPeriod(subscription, "start"),
        current_period_end: await subscriptionPeriod(subscription, "end"),
        cancel_at: subscription.cancel_at
          ? new Date(subscription.cancel_at * 1000).toISOString()
          : null,
        canceled_at: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000).toISOString()
          : null,
        trial_start: subscription.trial_start
          ? new Date(subscription.trial_start * 1000).toISOString()
          : null,
        trial_end: subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null,
      },
      { onConflict: "stripe_subscription_id" },
    );
  assertWritten(subscriptionError, "billing_subscriptions upsert");
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdated(
  subscription: StripeSubscriptionWithPeriod,
  supabase: ServiceClient,
) {
  const { error: updateError } = await supabase
    .from("billing_subscriptions")
    .update({
      plan: subscription.metadata?.plan_id || "pro",
      status: subscription.status,
      current_period_start: await subscriptionPeriod(subscription, "start"),
      current_period_end: await subscriptionPeriod(subscription, "end"),
      cancel_at: subscription.cancel_at
        ? new Date(subscription.cancel_at * 1000).toISOString()
        : null,
      canceled_at: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000).toISOString()
        : null,
      trial_start: subscription.trial_start
        ? new Date(subscription.trial_start * 1000).toISOString()
        : null,
      trial_end: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
    })
    .eq("stripe_subscription_id", subscription.id);
  assertWritten(updateError, "billing_subscriptions update");
}

/**
 * Handle subscription deletion
 */
async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  supabase: ServiceClient,
) {
  const { error: cancelError } = await supabase
    .from("billing_subscriptions")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);
  assertWritten(cancelError, "billing_subscriptions cancel");
}

/**
 * Handle successful invoice payment
 */
async function handleInvoicePaymentSucceeded(
  invoice: StripeInvoiceWithSubscription,
  supabase: ServiceClient,
) {
  // Get customer
  const { data: customer } = await supabase
    .from("billing_customers")
    .select("*")
    .eq("stripe_customer_id", invoice.customer)
    .single();

  if (!customer) {
    console.error("Customer not found for invoice");
    return;
  }

  // Resolve the subscription ID from the invoice's top-level subscription field
  // (still present in webhook payloads even though the TS type moved it under parent).
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : (invoice.subscription?.id ?? null);

  // Get subscription if exists
  const { data: subscription } = subscriptionId
    ? await supabase
        .from("billing_subscriptions")
        .select("*")
        .eq("stripe_subscription_id", subscriptionId)
        .single()
    : { data: null };

  // Insert or update invoice.
  //
  // onConflict names stripe_invoice_id for the same reason as the subscription
  // upsert above: without it the conflict target is the generated-UUID primary
  // key, which never collides, so a redelivered invoice.payment_succeeded would
  // raise a unique violation on stripe_invoice_id instead of updating the row.
  const { error: invoiceError } = await supabase
    .from("billing_invoices")
    .upsert(
      {
        customer_id: customer.id,
        subscription_id: subscription?.id,
        stripe_invoice_id: invoice.id,
        amount_paid: invoice.amount_paid,
        amount_due: invoice.amount_due,
        currency: invoice.currency,
        status: invoice.status,
        hosted_invoice_url: invoice.hosted_invoice_url,
        invoice_pdf: invoice.invoice_pdf,
      },
      { onConflict: "stripe_invoice_id" },
    );
  assertWritten(invoiceError, "billing_invoices upsert");
}

/**
 * Handle failed invoice payment
 */
async function handleInvoicePaymentFailed(
  invoice: StripeInvoiceWithSubscription,
  supabase: ServiceClient,
) {
  // Update invoice status
  const { error: failedInvoiceError } = await supabase
    .from("billing_invoices")
    .update({
      status: invoice.status,
    })
    .eq("stripe_invoice_id", invoice.id);
  assertWritten(failedInvoiceError, "billing_invoices payment-failed update");

  // TODO: Send notification to user about failed payment
  // TODO: Implement dunning management
}

/**
 * The billing_customers row for a Stripe customer.
 *
 * Throws rather than returning null. WHY: the previous code logged "Customer
 * not found" and fell through to `{ received: true }` with HTTP 200. Stripe
 * treats 2xx as delivered and never redelivers, so a subscription that arrived
 * a moment before its customer row was committed was lost permanently — the
 * card is charged monthly and the customer is on the free plan. A throw becomes
 * a 500, and Stripe's retry schedule fixes the race on its own.
 */
async function requireBillingCustomer(
  stripeCustomer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  supabase: ServiceClient,
): Promise<{ id: string; user_id: string }> {
  const stripeCustomerId =
    typeof stripeCustomer === "string" ? stripeCustomer : stripeCustomer?.id;

  if (!stripeCustomerId) {
    throw new Error("Stripe event carries no customer to attribute");
  }

  const { data: customer, error } = await supabase
    .from("billing_customers")
    .select("id, user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle<{ id: string; user_id: string }>();

  if (error) {
    throw new Error(`billing_customers lookup failed: ${error.message}`);
  }

  if (!customer) {
    throw new Error(
      `No billing_customers row for Stripe customer ${stripeCustomerId}. ` +
        `Returning 5xx so Stripe redelivers once the row exists.`,
    );
  }

  return customer;
}

/**
 * Grant Lifetime Pro from a completed payment.
 *
 * Reached from both `payment_intent.succeeded` and
 * `checkout.session.completed`, because which of the two arrives (and in which
 * order) depends on the payment method. Both key off the payment intent id, and
 * `plan_entitlements.stripe_payment_intent_id` is UNIQUE, so the second one to
 * land is a no-op rather than a second grant.
 */
async function grantLifetime(
  userId: string,
  grantsPlanId: string | undefined,
  paymentIntentId: string,
): Promise<void> {
  if (!grantsPlanId) {
    throw new Error(
      `payment ${paymentIntentId} is a lifetime purchase with no ` +
        `grants_plan_id — the customer paid but nothing says what for`,
    );
  }

  const result = await grantPlanEntitlement(
    userId,
    grantsPlanId,
    paymentIntentId,
  );

  if (result.duplicate) {
    console.log(`Lifetime entitlement for ${paymentIntentId} already granted.`);
  }
}

/**
 * Handle a successful one-off payment: a credit top-up or a Lifetime Pro
 * purchase.
 *
 * Both entitlements are granted ONLY here (or from checkout.session.completed),
 * never on the client and never optimistically from the Checkout return URL —
 * the return URL is a redirect the customer controls, while this event is
 * signed by Stripe.
 */
async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
) {
  const metadata = paymentIntent.metadata ?? {};
  const userId = metadata.user_id;

  if (!userId) {
    // Payments we did not originate (dashboard-created, older metadata shapes)
    // have nobody to credit. Logged rather than thrown so Stripe stops retrying
    // an event that will never succeed.
    if (metadata.type) {
      console.error(
        `payment_intent ${paymentIntent.id} has type "${metadata.type}" but no user_id`,
      );
    }
    return;
  }

  switch (metadata.type) {
    case "credit_purchase": {
      const creditQuantity = Number.parseInt(metadata.credit_quantity, 10);

      if (!Number.isInteger(creditQuantity) || creditQuantity <= 0) {
        throw new Error(
          `payment_intent ${paymentIntent.id} is a credit purchase with an ` +
            `unusable credit_quantity: ${metadata.credit_quantity}`,
        );
      }

      const result = await addPurchasedCredits(
        userId,
        creditQuantity,
        paymentIntent.id,
        paymentIntent.amount_received ?? undefined,
      );

      if (result.duplicate) {
        console.log(`Credits for ${paymentIntent.id} already granted.`);
      } else if (!result.success) {
        throw new Error(result.error ?? "Failed to credit purchase");
      }
      break;
    }

    case "lifetime_purchase":
      await grantLifetime(userId, metadata.grants_plan_id, paymentIntent.id);
      break;

    default:
      break;
  }
}

/**
 * Checkout finished. Stripe emits this alongside payment_intent.succeeded for
 * one-off purchases; handling both closes the gap where a payment method emits
 * one and not the other.
 */
async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
) {
  // `unpaid` sessions complete for invoice-style flows where money has not
  // moved yet. Granting on those would hand out product for an unpaid invoice.
  if (session.payment_status === "unpaid") {
    return;
  }

  const metadata = session.metadata ?? {};
  const userId = metadata.user_id ?? session.client_reference_id ?? undefined;
  const paymentIntentId = idOf(session.payment_intent);

  if (!userId || !paymentIntentId || metadata.type !== "lifetime_purchase") {
    return;
  }

  // Subscriptions and credit packs are provisioned by their own events; only
  // the lifetime grant needs the belt-and-braces second path.
  await grantLifetime(userId, "pro", paymentIntentId);
}

/**
 * Money came back out: a refund or a chargeback.
 *
 * Both revoke whatever the payment bought. Without this a customer could buy
 * Lifetime Pro, charge it back, and keep the entitlement permanently — there is
 * no renewal to fail, so nothing would ever take it away.
 *
 * Revocation is deliberately idempotent and quiet when there is nothing to
 * revoke: refunds also arrive for payments that granted nothing.
 */
async function handleMoneyReturned(
  event: Stripe.Charge | Stripe.Dispute,
  reason: "refund" | "dispute",
) {
  const paymentIntentId = idOf(event.payment_intent);

  if (!paymentIntentId) {
    console.error(`${reason} on ${event.id} has no payment_intent`);
    return;
  }

  const [entitlement, credits] = await Promise.all([
    revokeEntitlementForPayment(paymentIntentId, reason),
    revokePurchasedCredits(paymentIntentId),
  ]);

  console.log(
    `${reason} on ${paymentIntentId}: entitlement revoked=${entitlement.revoked}, ` +
      `credits revoked=${credits.revoked}`,
  );
}

/**
 * Handle failed payment intent
 */
async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  // Log the failed payment
  console.error(
    "Payment intent failed:",
    paymentIntent.id,
    paymentIntent.last_payment_error,
  );

  // TODO: Send notification to user about failed payment
  // TODO: Implement retry logic if appropriate
}

/**
 * Handle customer creation
 */
async function handleCustomerCreated(customer: Stripe.Customer) {
  // Customer is already created in our system before the Stripe customer
  // This webhook is mainly for logging and verification
  console.log("Customer created in Stripe:", customer.id);
}

/**
 * Handle customer updates
 */
async function handleCustomerUpdated(
  customer: Stripe.Customer,
  supabase: ServiceClient,
) {
  // Update customer information
  const { error: customerError } = await supabase
    .from("billing_customers")
    .update({
      email: customer.email,
      name: customer.name,
    })
    .eq("stripe_customer_id", customer.id);
  assertWritten(customerError, "billing_customers update");
}

/**
 * Log billing events for audit trail
 */
async function logBillingEvent(event: Stripe.Event, supabase: ServiceClient) {
  // Cast to a minimal shape — the actual webhook payload always carries
  // metadata and customer on the data object, but Stripe.Event.data.object
  // is a union of 70+ types so we use a local interface to avoid `any`.
  const obj = event.data.object as BillingEventObject;

  // Extract user_id from event metadata
  let userId: string | null = null;
  if (obj.metadata?.user_id) {
    userId = obj.metadata.user_id;
  } else if (obj.customer) {
    const customerId =
      typeof obj.customer === "string" ? obj.customer : obj.customer.id;
    // Try to get user_id from customer
    const { data: customer } = await supabase
      .from("billing_customers")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .single();
    userId = customer?.user_id ?? null;
  }

  if (userId) {
    const { error } = await supabase.from("billing_events").insert({
      user_id: userId,
      event_type: event.type,
      stripe_event_id: event.id,
      data: event.data,
      processed: true,
    });
    // 23505 = unique_violation on stripe_event_id: a concurrent delivery already
    // logged this event. That is the idempotency backstop working — not an error.
    if (error && error.code !== "23505") {
      throw error;
    }
  }
}
