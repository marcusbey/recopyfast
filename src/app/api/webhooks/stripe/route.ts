import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import type Stripe from "stripe";
import { stripe, requireWebhookSecret } from "@/lib/stripe/config";
import {
  findPaidPlanIdByStripePriceId,
  getLifetimeGrantPlanId,
  isPaidPlanId,
  resolveStripePriceId,
  type PaidPlanId,
} from "@/lib/stripe/plans";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  addPurchasedCredits,
  getPurchasedCreditGrant,
  restorePurchasedCredits,
  revokePurchasedCredits,
} from "@/lib/credits/system";
import {
  grantPlanEntitlement,
  restoreEntitlementForPayment,
  revokeEntitlementForPayment,
} from "@/lib/billing/entitlements";
import {
  readRevokedCredits,
  recordCreditRevocation,
} from "@/lib/billing/credit-revocations";
import { LIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/effective-plan";

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
  payment_intent?: string | Stripe.PaymentIntent | null;
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
        await handleChargeRefunded(event.data.object);
        break;

      case "charge.dispute.created":
        await handleDisputeCreated(event.data.object);
        break;

      case "charge.dispute.closed":
        await handleDisputeClosed(event.data.object);
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
 * Turn an UPDATE that matched no row into a throw.
 *
 * WHY — `assertWritten` cannot see this one: supabase-js reports a zero-row
 * UPDATE as `{ error: null }`, identical to a successful one. Stripe states its
 * events are unordered, and the normal SCA sequence delivers
 * `customer.subscription.updated` for a subscription that was born `incomplete`.
 * If that `updated` overtakes its `created` the update matches nothing, the
 * route answers 200, and Stripe discards the event permanently: the row settles
 * at `incomplete`, which is absent from LIVE_SUBSCRIPTION_STATUSES, so a paying
 * customer sits behind the paywall forever and nothing reconciles from Stripe.
 *
 * A 500 puts the event back on Stripe's retry schedule, which is what makes it
 * land *after* the `created` it overtook.
 *
 * Deliberately a refusal rather than an upsert: creating the row is
 * `handleSubscriptionCreated`'s job — it resolves the `billing_customers`
 * attribution and the fields only the `created` payload is authoritative for —
 * and an `updated` that invented a row would race the `created` still in flight.
 */
function assertRowMatched(
  rows: readonly unknown[] | null,
  operation: string,
): void {
  if ((rows?.length ?? 0) > 0) return;

  throw new Error(
    `${operation} matched no row. Returning 5xx so Stripe redelivers once it does.`,
  );
}

/**
 * The subscription as Stripe holds it NOW, not as the delivered event
 * snapshotted it at emission time.
 *
 * WHY EVERY SUBSCRIPTION WRITE GOES THROUGH THIS — Stripe states its events are
 * unordered and delivery is at-least-once. The handlers below wrote the payload
 * verbatim, keyed on `.eq("stripe_subscription_id", …)` and nothing else: no
 * timestamp comparison anywhere, and every column written unconditionally. So a
 * `customer.subscription.updated` that was slow or retried could land AFTER the
 * `customer.subscription.deleted` for the same subscription and write back
 * `status:'active'`, `plan:'pro'`, `cancel_at:null` and `canceled_at:null`. It
 * carries its own `event.id`, so the idempotency probe at the top of POST does
 * not stop it — it is late, not duplicate. Nothing in this codebase reconciles
 * `billing_subscriptions` from Stripe afterwards (`vercel.json`'s two crons are
 * not billing), so the resurrected row is permanent: an account holding Pro
 * that nobody is being charged for. A redelivered `created` reaches the same
 * end through its upsert.
 *
 * Re-reading makes delivery order stop mattering rather than merely making it
 * detectable, and it needs no schema change: the API always returns current
 * state, so whichever event triggered the write, the row ends up saying what
 * Stripe says today.
 *
 * RESIDUAL WINDOW, stated so nobody reads this as "ordered": two concurrent
 * deliveries can each retrieve and then write in the opposite order. That race
 * is bounded by the time between the retrieve and the write — milliseconds —
 * where the one this replaces was bounded by Stripe's retry schedule, i.e.
 * days. Closing it entirely needs a compare-and-set on the row.
 *
 * A failure here is left to propagate. Falling back to the payload snapshot
 * would reintroduce the stale write at exactly the moment the network is
 * unhealthy — which is when deliveries are late in the first place. The 500
 * puts the event back on Stripe's retry schedule instead.
 */
async function retrieveCurrentSubscription(
  subscriptionId: string,
): Promise<StripeSubscriptionWithPeriod> {
  return (await stripe.subscriptions.retrieve(
    subscriptionId,
  )) as StripeSubscriptionWithPeriod;
}

/**
 * Which plan this subscription is on, decided by the price it actually bills.
 *
 * WHY NOT METADATA — this used to be `subscription.metadata?.plan_id || "pro"`,
 * which made the most expensive plan the fail-open default on exactly the
 * subscriptions that carry no metadata: the ones created from the Stripe
 * dashboard or a Payment Link (see `requireBillingCustomer`'s caller, which
 * already compensates for the same gap on attribution). And `updateSubscription`
 * (src/lib/stripe/subscription.ts) is the only code path that keeps
 * `metadata.plan_id` in step with the price, so a plan change made anywhere
 * else — the dashboard, the API, a proration fix — left the metadata behind.
 *
 * Metadata is kept only as a tie-breaker between items that each match a
 * DIFFERENT plan, which `createCheckoutSession` never produces but a manual
 * dashboard edit can. It can no longer name a plan the prices do not.
 *
 * Throws when nothing matches. `billing_subscriptions_plan_valid` admits only
 * 'starter' and 'pro', so a guess is either a plan the customer is not paying
 * for or a 23514 that discards the event; a 500 is retried until the catalogue
 * and the subscription agree.
 */
async function resolveSubscriptionPlan(
  subscription: StripeSubscriptionWithPeriod,
): Promise<PaidPlanId> {
  const priceIds = (subscription.items?.data ?? [])
    .map((item) => item.price?.id)
    .filter((priceId): priceId is string => Boolean(priceId));

  const resolved = await Promise.all(
    priceIds.map((priceId) => findPaidPlanIdByStripePriceId(priceId)),
  );
  const candidates = [...new Set(resolved.filter(isPaidPlanId))];

  if (candidates.length === 1) return candidates[0];

  const declared = subscription.metadata?.plan_id;
  if (candidates.length > 1 && isPaidPlanId(declared)) {
    const tieBreak = candidates.find((candidate) => candidate === declared);
    if (tieBreak) return tieBreak;
  }

  throw new Error(
    `Stripe subscription ${subscription.id} bills price(s) ` +
      `[${priceIds.join(", ")}] which resolve to ${candidates.length} plan(s) ` +
      `in the catalogue. Refusing to record a plan this subscription is not ` +
      `paying for — check the plans table and the STRIPE_*_PRICE_ID variables.`,
  );
}

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreated(
  delivered: StripeSubscriptionWithPeriod,
  supabase: ServiceClient,
) {
  const subscription = await retrieveCurrentSubscription(delivered.id);

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
        plan: await resolveSubscriptionPlan(subscription),
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
  delivered: StripeSubscriptionWithPeriod,
  supabase: ServiceClient,
) {
  const subscription = await retrieveCurrentSubscription(delivered.id);

  const { data: updatedRows, error: updateError } = await supabase
    .from("billing_subscriptions")
    .update({
      plan: await resolveSubscriptionPlan(subscription),
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
    .eq("stripe_subscription_id", subscription.id)
    .select("id");
  assertWritten(updateError, "billing_subscriptions update");
  assertRowMatched(
    updatedRows,
    `billing_subscriptions update for ${subscription.id}`,
  );
}

/**
 * Handle subscription deletion
 *
 * DELIBERATELY DOES NOT RE-READ FROM STRIPE, unlike the two handlers above.
 * A cancelled subscription id can never become live again — Stripe issues a new
 * id for a resubscribe — so this event is terminal by definition and a retrieve
 * could only agree with it or fail. Agreeing adds nothing; failing would throw,
 * and the one handler whose job is to REMOVE access would then be the one that
 * needs Stripe to be reachable in order to run. The `updated` and `created`
 * handlers re-read precisely so that whichever of them arrives late converges
 * on this terminal state.
 *
 * `canceled_at` is taken from the payload rather than the clock: for a terminal
 * event that value is final, so the snapshot cannot be stale about it, and it
 * records when Stripe cancelled rather than when we processed the event.
 */
async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  supabase: ServiceClient,
) {
  const { data: canceledRows, error: cancelError } = await supabase
    .from("billing_subscriptions")
    .update({
      status: "canceled",
      canceled_at: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000).toISOString()
        : new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)
    .select("id");
  assertWritten(cancelError, "billing_subscriptions cancel");
  // A lost `deleted` leaves the account on a plan nobody is paying for, so the
  // zero-row case has to be as loud here as it is for `updated`.
  assertRowMatched(
    canceledRows,
    `billing_subscriptions cancel for ${subscription.id}`,
  );
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

  // The grant is permanent and worth $199, so the plan it names has to be one
  // this app actually sells. `plan_entitlements.plan_id` is a foreign key, but
  // it would happily accept any plan in the catalogue, including one that is no
  // longer on sale.
  if (!isPaidPlanId(grantsPlanId)) {
    throw new Error(
      `payment ${paymentIntentId} names "${grantsPlanId}" as the plan it ` +
        `grants, which is not a plan this app sells`,
    );
  }

  const result = await grantPlanEntitlement(
    userId,
    grantsPlanId,
    paymentIntentId,
  );

  if (result.duplicate) {
    console.log(`Lifetime entitlement for ${paymentIntentId} already granted.`);
    // Already handled on the first delivery, including the cancellation below.
    return;
  }

  await stopBillingForLifetimeOwner(userId, paymentIntentId);
}

/**
 * Stop charging someone monthly for a plan they have just bought outright.
 *
 * `readEffectivePlanId` ranks a grant above a subscription, so the moment the
 * entitlement lands the customer HAS Pro — and their Stripe subscription keeps
 * renewing at $19 a month beside it, invisibly, for a plan they now own. Nobody
 * would notice until a card statement.
 *
 * Cancelled at period end rather than immediately, on purpose: the current
 * period is already paid for, so ending it early would take money for nothing
 * and invite a refund request. There is no access gap either way — the grant
 * outranks the subscription for the whole remaining period.
 *
 * Failures here are logged, never thrown. The customer's $199 has been captured
 * and the entitlement is already written; throwing would make Stripe retry the
 * event, and `grantPlanEntitlement` would then short-circuit on the duplicate
 * and never reach this line again. A subscription that outlives its purchase is
 * a support ticket; a lost grant is a customer who paid $199 for nothing.
 */
async function stopBillingForLifetimeOwner(
  userId: string,
  paymentIntentId: string,
): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { data: subscriptions } = await supabase
      .from("billing_subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", userId)
      .in("status", LIVE_SUBSCRIPTION_STATUSES)
      .returns<Array<{ stripe_subscription_id: string | null }>>();

    // Guarded per subscription, not around the loop. With one `try` outside,
    // a transient Stripe error on the first row jumped straight to the catch
    // and every later subscription kept billing untouched — and there is no
    // second chance: `handleLifetimePurchase` returns early once the grant is
    // recorded, so a webhook retry never re-enters this function. Each
    // cancellation is independent, so one failing must not decide the rest.
    for (const subscription of subscriptions ?? []) {
      if (!subscription.stripe_subscription_id) continue;

      try {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: true,
          metadata: { cancelled_reason: "lifetime_purchase", paymentIntentId },
        });

        console.log(
          `Lifetime purchase ${paymentIntentId}: subscription ` +
            `${subscription.stripe_subscription_id} set to cancel at period end.`,
        );
      } catch (error) {
        console.error(
          `Lifetime purchase ${paymentIntentId} granted, but subscription ` +
            `${subscription.stripe_subscription_id} could not be cancelled — ` +
            `this customer is being billed for a plan they own. Cancel it by ` +
            `hand.`,
          error,
        );
      }
    }
  } catch (error) {
    // The lookup itself failed, so we do not know what to cancel.
    console.error(
      `Lifetime purchase ${paymentIntentId} granted, but the customer's ` +
        `subscriptions could not be read — check whether they are still ` +
        `being billed for a plan they own.`,
      error,
    );
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
  //
  // `grants_plan_id` is what the customer bought — createCheckoutSession writes
  // it onto the session from the catalogue. This used to be the literal "pro",
  // so whichever of this event and payment_intent.succeeded arrived first
  // decided the plan (the UNIQUE payment-intent id makes the loser a no-op), and
  // a catalogue selling lifetime Starter handed out Pro.
  await grantLifetime(
    userId,
    metadata.grants_plan_id ??
      (await catalogueLifetimeGrant(session.id, paymentIntentId)),
    paymentIntentId,
  );
}

/**
 * What Lifetime Pro confers, for a session that does not say.
 *
 * Only sessions minted before `grants_plan_id` was written at session level can
 * reach this. The payment has already been captured, so refusing outright would
 * strand a paid customer once Stripe gives up retrying; the catalogue is the
 * same source the session was built from, and is right unless the product has
 * been repointed since. Logged as an error either way, because that caveat is
 * real and this branch should stop appearing after the transition window.
 */
async function catalogueLifetimeGrant(
  sessionId: string,
  paymentIntentId: string,
): Promise<string | undefined> {
  const catalogued = await getLifetimeGrantPlanId();

  console.error(
    `Checkout session ${sessionId} (payment ${paymentIntentId}) carries no ` +
      `session-level grants_plan_id — it predates this deploy. Falling back to ` +
      `the catalogue, which currently grants ` +
      `${catalogued ?? "nothing (Lifetime Pro is not on sale)"}.`,
  );

  return catalogued ?? undefined;
}

/**
 * A refund was issued.
 *
 * Stripe emits `charge.refunded` for PARTIAL refunds too, and the amount is the
 * whole point: a $10 goodwill refund on a $199 purchase used to revoke Lifetime
 * Pro and empty the credit wallet, because the handler read only
 * `payment_intent`. Only a refund of the full charge takes the product back.
 *
 * `refunded` is Stripe's own "nothing is left on this charge" flag; the amounts
 * are compared as well because it is false while a full refund is still pending.
 */
async function handleChargeRefunded(charge: Stripe.Charge) {
  if (!isFullyRefunded(charge)) {
    console.log(
      `partial refund on ${charge.id}: ${charge.amount_refunded ?? 0} of ` +
        `${charge.amount} returned — entitlement and credits left in place.`,
    );
    return;
  }

  await handleMoneyReturned(charge, "refund");
}

/**
 * Is there nothing left on this charge?
 *
 * `refunded` is Stripe's own flag; the amounts are compared as well because it
 * is false while a full refund is still pending. Shared by the refund handler
 * and the dispute-closed handler so the two can never disagree about what
 * "fully refunded" means.
 */
function isFullyRefunded(charge: Stripe.Charge): boolean {
  return (
    charge.refunded === true || (charge.amount_refunded ?? 0) >= charge.amount
  );
}

/**
 * The charge a dispute was filed against.
 *
 * Webhook payloads carry `charge` as a bare id, so this is a round trip to
 * Stripe. Errors are left to propagate: a 500 that Stripe redelivers is
 * recoverable, whereas guessing the refund state either hands out a product we
 * have already refunded or strands a customer who won.
 */
async function disputedCharge(
  dispute: Stripe.Dispute,
): Promise<Stripe.Charge | null> {
  const charge = dispute.charge;

  if (!charge) return null;
  if (typeof charge !== "string") return charge;

  return stripe.charges.retrieve(charge);
}

/**
 * Money came back out: a full refund or a chargeback.
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
 * Did this dispute end with the money staying with us?
 *
 * `won` = the bank ruled for us. `warning_closed` = an early-warning enquiry the
 * customer dropped before it became a chargeback. Every other status either
 * means the money is gone (`lost`) or that the dispute is still running.
 */
function isDisputeClosedInOurFavour(status: Stripe.Dispute.Status): boolean {
  return status === "won" || status === "warning_closed";
}

/**
 * A chargeback was filed.
 *
 * Revoking is provisional — the bank holds the money from this moment — and a
 * dispute we go on to win has to give the wallet back.
 *
 * WHY IT ASKS STRIPE FOR THE STATUS — a `created` can be processed AFTER its own
 * `closed`, and re-running the revocation then would silently undo a correct
 * restoration with nothing left to reverse it: the dispute is over, so no further
 * event is coming. Two things make that reachable. Delivery is at-least-once and
 * explicitly unordered, so a first-time `created` can simply arrive late. And
 * dispute events used to miss the route's idempotency short-circuit entirely —
 * it reads `billing_events` rows keyed by Stripe event id, which `logBillingEvent`
 * only writes once it can attribute the event to a user, and a Dispute object
 * carries neither `metadata.user_id` nor `customer`. So every redelivery re-ran
 * this handler. `logBillingEvent` now resolves disputes through the payment
 * intent, which closes the redelivery half; the live status is what makes the
 * handler safe whatever order the events arrive in.
 *
 * A dispute still open (or `lost`) is revoked as normal: both revocation and its
 * record are idempotent, so re-applying is harmless, and a crash between the two
 * is COMPLETED by the redelivery rather than skipped.
 */
async function handleDisputeCreated(dispute: Stripe.Dispute) {
  const live = await stripe.disputes.retrieve(dispute.id);

  if (isDisputeClosedInOurFavour(live.status)) {
    console.log(
      `dispute ${dispute.id} is already closed as "${live.status}" — not ` +
        `re-revoking what winning it restored.`,
    );
    return;
  }

  await revokeForDispute(dispute);
}

/**
 * Take back what the disputed payment bought.
 *
 * The balance about to be clawed back is recorded against THIS dispute before it
 * is zeroed, while the row can still say what it was — see
 * `src/lib/billing/credit-revocations.ts`. A refund needs no such record, which
 * is why this lives here and not in `handleMoneyReturned`.
 */
async function revokeForDispute(dispute: Stripe.Dispute) {
  const paymentIntentId = idOf(dispute.payment_intent);

  if (paymentIntentId) {
    const wallet = await getPurchasedCreditGrant(paymentIntentId);

    if (wallet && wallet.credits_remaining > 0) {
      await recordCreditRevocation({
        stripeDisputeId: dispute.id,
        stripePaymentIntentId: paymentIntentId,
        credits: wallet.credits_remaining,
        userId: wallet.user_id,
      });
    }
  }

  // Reports the missing payment intent, if that is the case.
  await handleMoneyReturned(dispute, "dispute");
}

/**
 * A dispute finished.
 *
 * `charge.dispute.created` revokes provisionally — the bank holds the money from
 * the moment the chargeback is filed — so a dispute that closes in our favour
 * has to undo it. Nothing else does: a lifetime grant has no renewal to
 * re-grant it and there is no admin surface, so before this existed winning a
 * dispute left the customer paying $199 for nothing.
 */
async function handleDisputeClosed(dispute: Stripe.Dispute) {
  const paymentIntentId = idOf(dispute.payment_intent);

  if (!paymentIntentId) {
    console.error(`dispute ${dispute.id} closed with no payment_intent`);
    return;
  }

  // `lost` above all: the money is gone, so the revocation stands. It is applied
  // rather than assumed, because `created` is not guaranteed to have been
  // processed first — it can be delivered after this event, or its deliveries can
  // fail until Stripe gives up. Assuming left the worst case uncovered: a
  // chargeback that took the money AND left the customer holding the product.
  // Revoking again is a no-op.
  if (!isDisputeClosedInOurFavour(dispute.status)) {
    console.log(
      `dispute on ${paymentIntentId} closed as "${dispute.status}" — ` +
        `entitlement and credits stay revoked.`,
    );
    await revokeForDispute(dispute);
    return;
  }

  // Winning on paper is not the same as keeping the money. The standard way to
  // settle an early-fraud warning is to REFUND the charge, after which Stripe
  // closes the dispute as `warning_closed` (sometimes `won`) — a status that
  // otherwise reads as "restore everything". Restoring there would hand the
  // customer the refund AND the product they no longer paid for.
  const charge = await disputedCharge(dispute);

  if (!charge) {
    console.error(
      `dispute ${dispute.id} on ${paymentIntentId} closed as ` +
        `"${dispute.status}" with no charge to check for a refund — leaving the ` +
        `revocation in place rather than restoring what may have been refunded.`,
    );
    return;
  }

  if (isFullyRefunded(charge)) {
    console.log(
      `dispute on ${paymentIntentId} closed as "${dispute.status}", but charge ` +
        `${charge.id} was fully refunded — the customer has the money, so the ` +
        `entitlement and credits stay revoked.`,
    );
    return;
  }

  const entitlement = await restoreEntitlementForPayment(paymentIntentId);
  // This dispute's own clawback, not whatever an earlier dispute on the same
  // payment took: the customer may have spent some of what that one gave back.
  const revokedCredits = await readRevokedCredits(dispute.id);
  const credits = await restorePurchasedCredits(
    paymentIntentId,
    revokedCredits,
  );

  console.log(
    `dispute on ${paymentIntentId} closed as "${dispute.status}": entitlement ` +
      `restored=${entitlement.restored}, credits restored=${credits.restored}`,
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
 * Whose payment was this? Answered from our own tables, which key both kinds of
 * one-off purchase on the payment intent.
 *
 * Best-effort, like the customer lookup beside it: a failure here costs an audit
 * row, and throwing would fail an event whose real work has already succeeded.
 */
async function readUserIdForPayment(
  paymentIntentId: string | null,
  supabase: ServiceClient,
): Promise<string | null> {
  if (!paymentIntentId) return null;

  const [entitlement, credits] = await Promise.all([
    supabase
      .from("plan_entitlements")
      .select("user_id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle<{ user_id: string }>(),
    supabase
      .from("credit_purchases")
      .select("user_id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle<{ user_id: string }>(),
  ]);

  return entitlement.data?.user_id ?? credits.data?.user_id ?? null;
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
  } else if (obj.payment_intent) {
    // A Dispute carries neither of the above, so before this arm every dispute
    // event went unlogged — no audit row, and no entry in the seen-list the
    // idempotency short-circuit at the top of POST reads, which is why a
    // redelivered `charge.dispute.created` used to re-run its handler. What a
    // dispute does carry is the payment intent, and our own rows are keyed on it.
    userId = await readUserIdForPayment(idOf(obj.payment_intent), supabase);
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
