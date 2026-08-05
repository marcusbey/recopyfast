import type Stripe from "stripe";
import { stripe, STRIPE_CONFIG } from "./config";
import {
  getCreditPackConfig,
  getOneTimeProduct,
  resolveOneTimePriceId,
  resolveStripePriceId,
  type BillingPeriod,
  type PaidPlanId,
} from "./plans";
import { createOrGetCustomer } from "./customer";
import { createClient } from "@/lib/supabase/server";
import { resolveDeploymentOrigin } from "@/lib/deployment/origin";

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
  | { type: "credits"; quantity: number }
  | { type: "lifetime" }
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
   * True once the Stripe webhook has written the resulting subscription,
   * credit top-up or lifetime grant to our database. Paying is not the same as
   * being provisioned, so the UI waits on this rather than on `paymentStatus`.
   */
  reconciled: boolean;
  /** Only present for completed `setup` sessions. */
  paymentMethodId: string | null;
}

/**
 * Absolute origin used to build Checkout return URLs.
 *
 * Never derived from a request header — a spoofed `Origin` would turn Checkout
 * into an open redirect. `resolveDeploymentOrigin` reads only platform-set
 * environment variables and takes no request, so it does not weaken that.
 *
 * The deployment's own origin outranks NEXT_PUBLIC_APP_URL on a non-production
 * deployment for the reason register F-14 records: a preview inherits the
 * production NEXT_PUBLIC_APP_URL at build time, so a customer who paid on a
 * preview was returned to https://www.recopyfa.st holding a cookie scoped to
 * the preview host — i.e. logged out, staring at a paywall, having just been
 * charged. This is the same resolver `resolvePublicOrigin` uses for auth
 * redirects, so the two cannot send the same user to two different hosts.
 */
function getAppBaseUrl(): string {
  const deploymentOrigin = resolveDeploymentOrigin();
  if (deploymentOrigin) {
    return deploymentOrigin;
  }

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
            price: await resolveStripePriceId(
              intent.planId,
              intent.billingPeriod,
            ),
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

    case "credits": {
      const pack = await getCreditPackConfig();
      const product = await getOneTimeProduct("credits");
      const totalCredits = intent.quantity * pack.creditsPerPack;

      params = {
        ...baseParams,
        mode: "payment",
        line_items: [
          {
            quantity: intent.quantity,
            price_data: {
              currency: STRIPE_CONFIG.CURRENCY,
              unit_amount: Math.round(pack.pricePerPack * 100),
              product_data: {
                name: `${pack.creditsPerPack.toLocaleString("en-US")} AI credits`,
                description: product.description,
              },
            },
          },
        ],
        // handlePaymentIntentSucceeded credits the wallet from this metadata.
        // Credits are NEVER granted client-side.
        payment_intent_data: {
          setup_future_usage: "off_session",
          metadata: {
            user_id: userId,
            credit_quantity: totalCredits.toString(),
            type: "credit_purchase",
          },
        },
        metadata: { user_id: userId, type: "credit_purchase" },
      };
      break;
    }

    case "lifetime": {
      const product = await getOneTimeProduct("lifetime_pro");

      if (!product.grantsPlanId) {
        throw new Error(
          "Lifetime Pro is on sale but grants no plan. Set " +
            'plans."lifetime_pro".grants_plan_id.',
        );
      }

      // A configured Stripe Price, not price_data: a lifetime purchase is a
      // catalogue SKU that has to reconcile against the same product in
      // Stripe's dashboard reporting as every other lifetime sale.
      params = {
        ...baseParams,
        mode: "payment",
        line_items: [
          { price: await resolveOneTimePriceId("lifetime_pro"), quantity: 1 },
        ],
        allow_promotion_codes: true,
        // handlePaymentIntentSucceeded reads this to write the permanent grant.
        payment_intent_data: {
          metadata: {
            user_id: userId,
            grants_plan_id: product.grantsPlanId,
            type: "lifetime_purchase",
          },
        },
        metadata: { user_id: userId, type: "lifetime_purchase" },
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

    // A one-off payment is either a credit top-up or a lifetime purchase, and
    // the two land in different tables. Either row proves the webhook ran.
    const [{ data: creditPurchase }, { data: entitlement }] = await Promise.all(
      [
        // Written by addPurchasedCredits() from payment_intent.succeeded.
        supabase
          .from("credit_purchases")
          .select("id")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .maybeSingle(),
        supabase
          .from("plan_entitlements")
          .select("id")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .maybeSingle(),
      ],
    );

    return Boolean(creditPurchase) || Boolean(entitlement);
  }

  return true;
}
