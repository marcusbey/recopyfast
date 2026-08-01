import type Stripe from "stripe";
import { stripe, STRIPE_CONFIG } from "./config";
import {
  TICKET_CONFIG,
  getPaidPlan,
  type BillingPeriod,
  type PaidPlanId,
} from "./plans";
import { createOrGetCustomer } from "./customer";
import { createClient } from "@/lib/supabase/server";

/**
 * Stripe Checkout is the single entry point for every payment this app takes.
 *
 * Why hosted Checkout rather than embedded Elements:
 *  - No card data ever touches our origin (PCI SAQ-A instead of SAQ-A-EP).
 *  - Stripe owns 3DS/SCA challenges, decline retries, wallets and address/tax
 *    collection, so there is no client-side `confirmPayment` state machine.
 *  - Every flow ends in a webhook event the existing
 *    `src/app/api/webhooks/stripe/route.ts` handler already understands, so the
 *    database is reconciled by Stripe rather than optimistically by the client.
 */

export type CheckoutIntent =
  | { type: "subscription"; planId: PaidPlanId; billingPeriod: BillingPeriod }
  | { type: "tickets"; quantity: number }
  | { type: "payment_method" };

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface CheckoutSessionStatus {
  mode: Stripe.Checkout.Session.Mode;
  /** `open` = still payable, `complete` = finished, `expired` = abandoned. */
  status: Stripe.Checkout.Session.Status | null;
  paymentStatus: Stripe.Checkout.Session.PaymentStatus;
  /**
   * True once the Stripe webhook has written the resulting subscription or
   * ticket credit to our database. Paying is not the same as being provisioned,
   * so the UI waits on this rather than on `paymentStatus`.
   */
  reconciled: boolean;
  /** Only present for completed `setup` sessions. */
  paymentMethodId: string | null;
}

/**
 * Absolute origin used to build Checkout return URLs.
 *
 * Never derived from a request header — a spoofed `Origin` would turn Checkout
 * into an open redirect.
 */
function getAppBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  throw new Error(
    "NEXT_PUBLIC_APP_URL is not set — cannot build Stripe Checkout return URLs",
  );
}

function buildReturnUrls(): { successUrl: string; cancelUrl: string } {
  const base = `${getAppBaseUrl()}/dashboard/billing`;
  return {
    // {CHECKOUT_SESSION_ID} is substituted by Stripe on redirect.
    successUrl: `${base}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}?checkout=cancelled`,
  };
}

function resolvePriceId(
  planId: PaidPlanId,
  billingPeriod: BillingPeriod,
): string {
  const plan = getPaidPlan(planId);
  const priceId =
    billingPeriod === "yearly" ? plan.yearlyPriceId : plan.priceId;

  if (!priceId) {
    throw new Error(
      `No Stripe price configured for the ${plan.name} plan (${billingPeriod}). ` +
        "Set the matching STRIPE_*_PRICE_ID environment variable.",
    );
  }
  return priceId;
}

/**
 * Create a Checkout Session for the given intent.
 *
 * Every session carries `client_reference_id = userId` so the status endpoint
 * can prove the session belongs to the caller, and metadata that the Stripe
 * webhook uses to attribute the resulting subscription/payment to a user.
 */
export async function createCheckoutSession(
  userId: string,
  email: string,
  intent: CheckoutIntent,
  name?: string,
): Promise<CheckoutSessionResult> {
  // Ensures a billing_customers row exists before any webhook needs to resolve
  // the Stripe customer back to a user.
  const { stripeCustomer } = await createOrGetCustomer(userId, email, name);
  const { successUrl, cancelUrl } = buildReturnUrls();

  const baseParams = {
    customer: stripeCustomer.id,
    client_reference_id: userId,
    success_url: successUrl,
    cancel_url: cancelUrl,
  } satisfies Partial<Stripe.Checkout.SessionCreateParams>;

  let params: Stripe.Checkout.SessionCreateParams;

  switch (intent.type) {
    case "subscription": {
      params = {
        ...baseParams,
        mode: "subscription",
        line_items: [
          {
            price: resolvePriceId(intent.planId, intent.billingPeriod),
            quantity: 1,
          },
        ],
        allow_promotion_codes: true,
        // Read by handleSubscriptionCreated / handleSubscriptionUpdated in the
        // Stripe webhook to attribute the subscription and record the plan.
        subscription_data: {
          metadata: {
            user_id: userId,
            plan_id: intent.planId,
            billing_period: intent.billingPeriod,
          },
        },
        metadata: { user_id: userId, plan_id: intent.planId },
      };
      break;
    }

    case "tickets": {
      const totalTickets = intent.quantity * TICKET_CONFIG.TICKETS_PER_PURCHASE;
      const unitAmount = Math.round(
        TICKET_CONFIG.TICKETS_PER_PURCHASE *
          TICKET_CONFIG.PRICE_PER_TICKET *
          100,
      );

      params = {
        ...baseParams,
        mode: "payment",
        line_items: [
          {
            quantity: intent.quantity,
            price_data: {
              currency: STRIPE_CONFIG.CURRENCY,
              unit_amount: unitAmount,
              product_data: {
                name: `${TICKET_CONFIG.TICKETS_PER_PURCHASE} AI tickets`,
                description:
                  "Pay-per-use credits for AI suggestions and translations",
              },
            },
          },
        ],
        // handlePaymentIntentSucceeded credits the wallet from this metadata.
        // Tickets are NEVER credited client-side.
        payment_intent_data: {
          setup_future_usage: "off_session",
          metadata: {
            user_id: userId,
            ticket_quantity: totalTickets.toString(),
            type: "ticket_purchase",
          },
        },
        metadata: { user_id: userId, type: "ticket_purchase" },
      };
      break;
    }

    case "payment_method": {
      params = {
        ...baseParams,
        mode: "setup",
        currency: STRIPE_CONFIG.CURRENCY,
        setup_intent_data: { metadata: { user_id: userId } },
        metadata: { user_id: userId, type: "payment_method_setup" },
      };
      break;
    }
  }

  const session = await stripe.checkout.sessions.create(params);

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout URL");
  }

  return { sessionId: session.id, url: session.url };
}

/**
 * Read back the outcome of a Checkout Session after the user returns.
 *
 * This is a read-only reconciliation helper: it never grants entitlements. The
 * database is updated by the Stripe webhook; the UI polls this to know when
 * that has landed.
 */
export async function getCheckoutSessionStatus(
  userId: string,
  sessionId: string,
): Promise<CheckoutSessionStatus> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["setup_intent"],
  });

  if (session.client_reference_id !== userId) {
    throw new Error("Checkout session does not belong to the current user");
  }

  let paymentMethodId: string | null = null;
  if (session.setup_intent && typeof session.setup_intent === "object") {
    const paymentMethod = session.setup_intent.payment_method;
    paymentMethodId =
      typeof paymentMethod === "string"
        ? paymentMethod
        : (paymentMethod?.id ?? null);
  }

  return {
    mode: session.mode,
    status: session.status,
    paymentStatus: session.payment_status,
    reconciled: await hasWebhookLanded(session),
    paymentMethodId,
  };
}

function idOf(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Has the Stripe webhook already written this session's outcome to our tables?
 *
 * Reads go through the RLS-scoped client, so a user can only ever observe their
 * own rows. `setup` sessions attach a card directly in Stripe and have nothing
 * to reconcile.
 */
async function hasWebhookLanded(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  if (session.status !== "complete") {
    return false;
  }

  const supabase = await createClient();

  if (session.mode === "subscription") {
    const subscriptionId = idOf(session.subscription);
    if (!subscriptionId) return false;

    const { data } = await supabase
      .from("billing_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    return Boolean(data);
  }

  if (session.mode === "payment") {
    const paymentIntentId = idOf(session.payment_intent);
    if (!paymentIntentId) return false;

    // Written by add_tickets() from the payment_intent.succeeded handler.
    const { data } = await supabase
      .from("ticket_transactions")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();

    return Boolean(data);
  }

  return true;
}
