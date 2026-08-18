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
// Used only inside readEventUserId to avoid operating on the full
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
  //
  // `processed` is read, not just the row's existence. See claimBillingEvent:
  // a row with `processed = false` is an attempt that started and did not
  // finish, which MUST be re-run rather than answered 200 — the effect never
  // happened, and Stripe only redelivers because we refused it last time.
  const { data: existingEvent, error: idempotencyError } = await supabase
    .from("billing_events")
    .select("id, processed")
    .eq("stripe_event_id", event.id)
    .maybeSingle<{ id: string; processed: boolean | null }>();

  if (idempotencyError) {
    console.error("Idempotency check failed:", idempotencyError.message);
    return NextResponse.json(
      { error: "Webhook idempotency check failed" },
      { status: 500 },
    );
  } else if (existingEvent?.processed) {
    console.log(
      `Stripe event ${event.id} already processed — skipping (idempotent).`,
    );
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    // Claim the event BEFORE running its handler. Nothing below this line may
    // reach a handler without a `billing_events` row naming this event id.
    // Inside the try so a failed claim takes the same 500 path as a failed
    // effect: the event is then unclaimed, and Stripe's redelivery retries it.
    if (!existingEvent && !(await claimBillingEvent(event, supabase))) {
      console.log(
        `Stripe event ${event.id} was claimed by a concurrent delivery — skipping.`,
      );
      return NextResponse.json({ received: true, duplicate: true });
    }

    console.log("Processing Stripe webhook:", event.type);

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

    // The claim above says this event was attempted; this says it finished.
    await markBillingEventProcessed(event, supabase);

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
  // Get customer.
  //
  // Through `requireBillingCustomer` because this used to be a bare
  // `{ data: customer }` destructured off a `.single()`: the error was dropped,
  // so a connection failure and a genuine "no such customer" both fell through
  // the same `return` — which answers HTTP 200. Stripe treats that as delivered
  // and never redelivers, so the paid invoice was lost permanently, and the
  // failure mode was worst exactly when the row DID exist and the query merely
  // failed. The helper throws instead, and the 500 puts the event back on
  // Stripe's retry schedule.
  const customer = await requireBillingCustomer(invoice.customer, supabase);

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
 *
 * DELIBERATELY NOT `assertRowMatched`, unlike the subscription handlers.
 * `billing_invoices` rows are written by `invoice.payment_succeeded` and by
 * nothing else, so a `payment_failed` for an invoice that never succeeded — a
 * card declined on the very first attempt, a subscription that never started —
 * matches zero rows as its NORMAL outcome. Refusing it would 500 an event that
 * can never succeed and hand Stripe an event to retry for three days.
 *
 * It is said out loud instead. The bug being fixed here is not the zero rows,
 * it is that `assertWritten` sees only `error` and supabase-js reports a
 * zero-row UPDATE as `{ error: null }` — so a write that did nothing was
 * indistinguishable in the logs from one that worked.
 */
async function handleInvoicePaymentFailed(
  invoice: StripeInvoiceWithSubscription,
  supabase: ServiceClient,
) {
  // Update invoice status
  const { data: failedRows, error: failedInvoiceError } = await supabase
    .from("billing_invoices")
    .update({
      status: invoice.status,
    })
    .eq("stripe_invoice_id", invoice.id)
    .select("id");
  assertWritten(failedInvoiceError, "billing_invoices payment-failed update");

  if ((failedRows?.length ?? 0) === 0) {
    console.log(
      `invoice.payment_failed for ${invoice.id} matched no billing_invoices ` +
        `row — expected when the invoice never succeeded, since only ` +
        `invoice.payment_succeeded writes that table. Nothing was updated.`,
    );
  }

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
 * How many invoice payments to consider when tying a disputed payment to a
 * subscription. A payment intent normally pays exactly one invoice; the cap is
 * there so an unexpectedly long list is bounded rather than paged through.
 */
const DISPUTED_INVOICE_LOOKUP_LIMIT = 10;

/** Subscription statuses that are already over — nothing left to stop. */
const TERMINAL_SUBSCRIPTION_STATUSES: readonly Stripe.Subscription.Status[] = [
  "canceled",
  "incomplete_expired",
];

/**
 * The subscription an invoice was generated by, or null.
 *
 * The API version pinned in STRIPE_CONFIG moved this under
 * `parent.subscription_details`, but a webhook payload from an endpoint
 * configured on an older version still carries the top-level `subscription` —
 * the same split `StripeInvoiceWithSubscription` exists for. Both are read so
 * the answer does not depend on which version the dashboard is set to.
 */
function subscriptionOfInvoice(invoice: Stripe.Invoice): string | null {
  const fromParent =
    invoice.parent?.type === "subscription_details"
      ? idOf(invoice.parent.subscription_details?.subscription)
      : null;

  return (
    fromParent ?? idOf((invoice as StripeInvoiceWithSubscription).subscription)
  );
}

/**
 * Which subscription the disputed payment actually paid for — resolved
 * POSITIVELY, through Stripe's own payment-to-invoice mapping, or not at all.
 *
 * `charge.invoice` and `payment_intent.invoice` no longer exist in this API
 * version; `invoicePayments` is what replaced them, and it is the only link
 * from a payment intent to an invoice that Stripe still exposes.
 *
 * Returns null — never a best guess — when the payment paid no invoice (a
 * Lifetime Pro purchase or a credit top-up), when the invoice came from
 * something other than a subscription, or when it maps to MORE than one
 * subscription. The caller cancels what this returns, so "I do not know" has to
 * be a value it can express.
 */
async function subscriptionForDisputedPayment(
  paymentIntentId: string,
): Promise<string | null> {
  const payments = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    limit: DISPUTED_INVOICE_LOOKUP_LIMIT,
  });

  const invoiceIds = [
    ...new Set(
      payments.data
        // Not `idOf`: an expanded Invoice types its `id` as optional (a draft
        // has none), which that helper's `{ id: string }` cannot accept.
        .map((payment) =>
          typeof payment.invoice === "string"
            ? payment.invoice
            : (payment.invoice?.id ?? null),
        )
        .filter((invoiceId): invoiceId is string => Boolean(invoiceId)),
    ),
  ];

  const resolved = await Promise.all(
    invoiceIds.map(async (invoiceId) =>
      subscriptionOfInvoice(await stripe.invoices.retrieve(invoiceId)),
    ),
  );
  const subscriptionIds = [
    ...new Set(
      resolved.filter((subscriptionId): subscriptionId is string =>
        Boolean(subscriptionId),
      ),
    ),
  ];

  if (subscriptionIds.length === 1) return subscriptionIds[0];

  if (subscriptionIds.length > 1) {
    console.error(
      `payment ${paymentIntentId} paid invoices belonging to ` +
        `${subscriptionIds.length} subscriptions (${subscriptionIds.join(", ")}). ` +
        `Refusing to decide which one the chargeback is against — cancel it by hand.`,
    );
  }

  return null;
}

/**
 * Stop billing a subscription whose invoice was charged back.
 *
 * WHY THIS EXISTS — `handleMoneyReturned` revokes through
 * `revokeEntitlementForPayment` and `revokePurchasedCredits`, both keyed on
 * `stripe_payment_intent_id`, a column only `plan_entitlements` and
 * `credit_purchases` carry. `billing_subscriptions` has none and no dispute or
 * refund path touched it, so charging back a monthly invoice took nothing away:
 * the row stayed `active`, the plan stayed granted, and Stripe kept billing the
 * card that had just reversed the last charge.
 *
 * CANCEL AT PERIOD END, NOT IMMEDIATELY, for the reason
 * `stopBillingForLifetimeOwner` states beside it: a chargeback can be filed
 * months after the charge, so the period running today may be one the customer
 * has since paid for in full. Ending it early would take money for nothing and
 * invite the next dispute. The cost is that a chargeback against the CURRENT
 * invoice buys the rest of that period — bounded by one billing cycle, and the
 * flag can be flipped back by hand to end it sooner.
 *
 * ONLY FROM A DISPUTE THAT CLOSED AGAINST US. `charge.dispute.created` revokes
 * provisionally because the bank merely holds the money and winning restores
 * everything; a cancellation has no equivalent undo — Stripe issues a new id on
 * resubscribe — and un-setting the flag would clobber a customer who had
 * cancelled themselves. Provisional actions must be reversible; this one is not.
 *
 * Idempotent by reading Stripe first: a redelivered dispute finds the flag
 * already set, or the subscription already gone, and does nothing. Updating a
 * cancelled subscription is an API error, which would otherwise 500 every
 * redelivery of a dispute whose work was already done.
 */
async function stopBillingForChargeback(
  dispute: Stripe.Dispute,
  paymentIntentId: string,
): Promise<void> {
  const subscriptionId = await subscriptionForDisputedPayment(paymentIntentId);

  if (!subscriptionId) {
    console.log(
      `dispute ${dispute.id} on ${paymentIntentId} is not tied to a single ` +
        `subscription invoice — no subscription billing to stop.`,
    );
    return;
  }

  const subscription = await retrieveCurrentSubscription(subscriptionId);

  if (TERMINAL_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
    console.log(
      `dispute ${dispute.id}: subscription ${subscriptionId} is already ` +
        `"${subscription.status}" — nothing to stop.`,
    );
    return;
  }

  if (subscription.cancel_at_period_end) {
    console.log(
      `dispute ${dispute.id}: subscription ${subscriptionId} is already set to ` +
        `cancel at period end — leaving it alone.`,
    );
    return;
  }

  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
    metadata: { cancelled_reason: "chargeback", disputeId: dispute.id },
  });

  console.log(
    `dispute ${dispute.id} lost on ${paymentIntentId}: subscription ` +
      `${subscriptionId} set to cancel at period end.`,
  );
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
 * it reads `billing_events` rows keyed by Stripe event id, which the audit
 * insert only wrote once it could attribute the event to a user, and a Dispute
 * object carries neither `metadata.user_id` nor `customer`. So every redelivery
 * re-ran this handler. `readEventUserId` now resolves disputes through the
 * payment intent, and `claimBillingEvent` writes the row whether or not that
 * succeeds, which closes the redelivery half; the live status is what makes the
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
    // Our own tables first, Stripe second: a subscription invoice buys neither
    // an entitlement row nor credits, so the revocation above takes nothing
    // away and this is the only thing that ends a charged-back plan.
    await stopBillingForChargeback(dispute, paymentIntentId);
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
 *
 * DELIBERATELY NOT `assertRowMatched`, for the same reason as
 * `handleInvoicePaymentFailed` and one of its own: Stripe emits
 * `customer.updated` for every customer on the account, including ones this app
 * never created — made by hand in the dashboard, or left behind when
 * `createOrGetCustomer`'s orphan cleanup could not delete one. There is nothing
 * to update for those and nothing a retry would fix.
 *
 * What this event carries is `email` and `name`. Losing them costs a stale
 * contact detail on a row Stripe remains authoritative for, which does not
 * justify a three-day retry loop on every untracked customer — but it does not
 * justify claiming the write happened either, which is what `assertWritten`
 * alone did: supabase-js reports a zero-row UPDATE as `{ error: null }`.
 */
async function handleCustomerUpdated(
  customer: Stripe.Customer,
  supabase: ServiceClient,
) {
  // Update customer information
  const { data: customerRows, error: customerError } = await supabase
    .from("billing_customers")
    .update({
      email: customer.email,
      name: customer.name,
    })
    .eq("stripe_customer_id", customer.id)
    .select("id");
  assertWritten(customerError, "billing_customers update");

  if ((customerRows?.length ?? 0) === 0) {
    console.log(
      `customer.updated for ${customer.id} matched no billing_customers row — ` +
        `this app does not track that Stripe customer. Nothing was updated.`,
    );
  }
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
 * Whose event this is, for the audit trail. Best-effort by design.
 *
 * A failure to attribute costs the `user_id` on one row; it must never cost the
 * row itself — see `claimBillingEvent`.
 */
async function readEventUserId(
  event: Stripe.Event,
  supabase: ServiceClient,
): Promise<string | null> {
  // Cast to a minimal shape — the actual webhook payload always carries
  // metadata and customer on the data object, but Stripe.Event.data.object
  // is a union of 70+ types so we use a local interface to avoid `any`.
  const obj = event.data.object as BillingEventObject;

  if (obj.metadata?.user_id) {
    return obj.metadata.user_id;
  }

  if (obj.customer) {
    const customerId =
      typeof obj.customer === "string" ? obj.customer : obj.customer.id;
    const { data: customer } = await supabase
      .from("billing_customers")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle<{ user_id: string }>();
    return customer?.user_id ?? null;
  }

  if (obj.payment_intent) {
    // A Dispute carries neither of the above, so before this arm every dispute
    // event went unlogged — no audit row, and no entry in the seen-list the
    // idempotency short-circuit at the top of POST reads, which is why a
    // redelivered `charge.dispute.created` used to re-run its handler. What a
    // dispute does carry is the payment intent, and our own rows are keyed on it.
    return readUserIdForPayment(idOf(obj.payment_intent), supabase);
  }

  return null;
}

/**
 * Claim this event by writing its `billing_events` row BEFORE the switch runs.
 *
 * Returns false when a concurrent delivery got there first.
 *
 * WHY BEFORE — this used to be `logBillingEvent`, called AFTER the switch and
 * gated on `if (userId)`, which is the inverse of the rule ADR 011 states:
 * record what you are about to do before doing it. Two things followed.
 *
 * An event whose user could not be resolved — a dashboard-created payment, a
 * Dispute whose purchase we never recorded — produced NO row at all, so the
 * probe at the top of POST had nothing to match and every single redelivery
 * re-ran the handler from scratch. `billing_events.user_id` is nullable
 * precisely so that cannot happen (see the migration that creates the table);
 * the gate was throwing away the one thing that makes the probe work.
 *
 * And any crash between an effect and the log re-applied that effect on the
 * retry. Replay safety rested entirely on four UNIQUE constraints elsewhere —
 * `credit_purchases.stripe_payment_intent_id`,
 * `plan_entitlements.stripe_payment_intent_id`, `restorePurchasedCredits`
 * applying a floor rather than a delta, and `recordCreditRevocation` writing
 * before the clawback. Load-bearing, undocumented, and inherited by the next
 * handler someone adds without one.
 *
 * `processed: false` on purpose. The row means "this delivery started", and
 * `markBillingEventProcessed` is what turns it into "this delivery finished".
 * Writing `true` here would leave the column asserting something false, and
 * would make a half-completed attempt indistinguishable from a completed one —
 * the probe would swallow Stripe's redelivery and the effect would be lost for
 * good. That is ADR 011's claim-then-update shape rather than its rejected
 * insert-and-reject-on-conflict alternative.
 */
async function claimBillingEvent(
  event: Stripe.Event,
  supabase: ServiceClient,
): Promise<boolean> {
  const userId = await readEventUserId(event, supabase);

  const { error } = await supabase.from("billing_events").insert({
    user_id: userId,
    event_type: event.type,
    stripe_event_id: event.id,
    data: event.data,
    processed: false,
  });

  // 23505 = unique_violation on stripe_event_id: a concurrent delivery already
  // claimed this event. That is the idempotency backstop working — not an error.
  if (error?.code === "23505") {
    return false;
  }

  assertWritten(error, "billing_events claim");
  return true;
}

/**
 * Mark the claimed event as done, once the switch has returned.
 *
 * A failure here throws, as every other write in this file does. The effects
 * have already been applied at this point, so the 500 costs a redelivery that
 * re-runs handlers which are individually idempotent — whereas answering 200
 * over a ledger row still saying `processed: false` would leave the ledger
 * lying about an event Stripe will never send again.
 */
async function markBillingEventProcessed(
  event: Stripe.Event,
  supabase: ServiceClient,
) {
  const { data: rows, error } = await supabase
    .from("billing_events")
    .update({ processed: true })
    .eq("stripe_event_id", event.id)
    .select("id");

  assertWritten(error, "billing_events processed update");
  assertRowMatched(rows, `billing_events processed update for ${event.id}`);
}
