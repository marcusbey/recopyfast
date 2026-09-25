import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  createCheckoutSession,
  expireCheckoutSession,
  findCheckoutSessionForIntent,
  getCheckoutSessionStatus,
  preflightLifetimeCheckout,
  type CheckoutIntent,
} from "@/lib/stripe/checkout";
import {
  getRecoverableSubscriptionCheckout,
  getUserSubscription,
} from "@/lib/stripe/subscription";
import {
  getCreditPackConfig,
  getOneTimeProduct,
  isAgencyCheckoutEnabled,
  isBillingPeriod,
  isLifetimeProductId,
  isPaidPlanId,
  resolveStripePriceId,
} from "@/lib/stripe/plans";
import { getGrantedPlanIds } from "@/lib/billing/entitlements";
import {
  attachCheckoutSession,
  claimSubscriptionCheckoutIntent,
  ExistingSubscriptionBlocksCheckoutError,
  expireUnattachedSubscriptionCheckoutIntent,
  finishSubscriptionCheckoutIntent,
  STRIPE_CHECKOUT_MIN_EXPIRY_MS,
  SUBSCRIPTION_CHECKOUT_TTL_MS,
} from "@/lib/billing/checkout-reservation";
import { withUserLock } from "@/lib/billing/user-lock";
import {
  bindFoundingAgencyCheckout,
  getOpenFoundingAgencyCheckout,
  reconcileExpiredFoundingAgencyCheckouts,
  releaseFoundingAgencyCheckout,
  reserveFoundingAgencySpot,
} from "@/lib/billing/founding-agency";
import { LIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/effective-plan";
import { enforceRateLimit } from "@/lib/api/rate-limit";

/**
 * Stripe Checkout entry point.
 *
 * POST creates a hosted Checkout Session and returns its URL; the browser
 * redirects there. GET reads a finished session back so the UI can wait for the
 * Stripe webhook to reconcile our database before it claims success.
 */

interface CheckoutRequestBody {
  intent?: unknown;
  planId?: unknown;
  billingPeriod?: unknown;
  productId?: unknown;
  quantity?: unknown;
}

type ParsedIntent =
  | { ok: true; intent: CheckoutIntent }
  | { ok: false; error: string };

function isStripeIdempotencyConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { type?: unknown; code?: unknown };
  return (
    candidate.type === "StripeIdempotencyError" ||
    candidate.code === "idempotency_key_in_use"
  );
}

function isDefinitiveStripeCreateFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const type = (error as { type?: unknown }).type;
  return (
    !isStripeIdempotencyConflict(error) &&
    (type === "StripeInvalidRequestError" ||
      type === "StripeAuthenticationError" ||
      type === "StripePermissionError")
  );
}

async function parseIntent(body: CheckoutRequestBody): Promise<ParsedIntent> {
  switch (body.intent) {
    case "subscription": {
      if (!isPaidPlanId(body.planId)) {
        return { ok: false, error: "Invalid plan ID" };
      }
      const billingPeriod = body.billingPeriod ?? "monthly";
      if (!isBillingPeriod(billingPeriod)) {
        return { ok: false, error: "Invalid billing period" };
      }
      return {
        ok: true,
        intent: { type: "subscription", planId: body.planId, billingPeriod },
      };
    }

    case "credits": {
      const { maxPacksPerPurchase } = await getCreditPackConfig();
      const quantity = body.quantity;
      if (
        typeof quantity !== "number" ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > maxPacksPerPurchase
      ) {
        return {
          ok: false,
          error: `Invalid quantity. Must be a whole number between 1 and ${maxPacksPerPurchase}.`,
        };
      }
      return { ok: true, intent: { type: "credits", quantity } };
    }

    case "lifetime": {
      const productId = body.productId ?? "lifetime_pro";
      if (!isLifetimeProductId(productId)) {
        return { ok: false, error: "Invalid lifetime product ID" };
      }
      return { ok: true, intent: { type: "lifetime", productId } };
    }

    case "payment_method":
      return { ok: true, intent: { type: "payment_method" } };

    default:
      return { ok: false, error: "Invalid checkout intent" };
  }
}

/**
 * POST /api/billing/checkout
 * Body: { intent: "subscription" | "credits" | "lifetime" | "payment_method", ... }
 * Returns: { url, sessionId }
 */
export async function POST(req: NextRequest) {
  try {
    const ipLimited = await enforceRateLimit(req, {
      limit: "CHECKOUT_IP",
      endpoint: "billing/checkout:ip",
      identifierType: "ip",
      // This coarse bucket is the unauthenticated flood guard. It fails open
      // because the request body has not been trusted yet, so it cannot know
      // whether this is the one checkout type (Founding Agency) whose capacity
      // hold must stop when Redis is unavailable. The intent-aware user bucket
      // below makes that fail-closed decision before the hold is reserved.
      onStoreFailure: "allow",
      message: "Too many checkout attempts. Please try again later.",
    });
    if (ipLimited) return ipLimited;

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as CheckoutRequestBody;
    const parsed = await parseIntent(body);

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    if (
      !isAgencyCheckoutEnabled() &&
      ((parsed.intent.type === "subscription" &&
        parsed.intent.planId === "agency") ||
        (parsed.intent.type === "lifetime" &&
          parsed.intent.productId === "lifetime_agency"))
    ) {
      return NextResponse.json(
        { error: "Agency checkout is temporarily unavailable." },
        { status: 503 },
      );
    }

    const existingSubscription =
      parsed.intent.type === "subscription" ||
      (parsed.intent.type === "lifetime" &&
        (parsed.intent.productId ?? "lifetime_pro") === "lifetime_pro")
        ? await getUserSubscription(user.id)
        : null;

    // A customer who already pays us changes plans through
    // PUT /api/billing/subscription (proration), not a second Checkout.
    //
    // getUserSubscription only sees a row after the webhook lands, so two
    // overlapping POSTs both pass it. The lock serialises this isolate; the
    // reservation row (unique on user_id) serialises across isolates.
    if (parsed.intent.type === "subscription") {
      const requestedChoice = {
        stripePriceId: await resolveStripePriceId(
          parsed.intent.planId,
          parsed.intent.billingPeriod,
        ),
        planId: parsed.intent.planId,
        billingPeriod: parsed.intent.billingPeriod,
      };

      const locked = await withUserLock(user.id, async () => {
        // These rows can recover into payable subscriptions, including after
        // a bank-debit payment spends days in `processing`. Checkout therefore
        // sends the customer back to the current obligation and never cancels
        // it as a side effect of asking to buy another subscription.
        const recovery = await getRecoverableSubscriptionCheckout(
          supabase,
          user.id,
        );
        if (recovery) {
          return { kind: "recovery" as const, recovery };
        }

        if (existingSubscription) {
          return { kind: "conflict" as const, alreadySubscribed: true };
        }

        // Read the table directly so a concurrent test can still barrier on
        // getUserSubscription (called once per request, above) while this
        // isolate still notices a webhook that landed after that read.
        const { data: liveRow, error: liveRowError } = await supabase
          .from("billing_subscriptions")
          .select("id")
          .eq("user_id", user.id)
          .in("status", LIVE_SUBSCRIPTION_STATUSES)
          .maybeSingle();
        if (liveRowError) {
          throw new Error(
            `Failed to verify existing subscription: ${liveRowError.message}`,
          );
        }
        if (liveRow) {
          return { kind: "conflict" as const, alreadySubscribed: true };
        }

        const intentClient = createServiceRoleClient();

        // One retry is enough: an expired known session is released, then the
        // second claim creates (or observes) the successor. The partial UNIQUE
        // index remains the cross-isolate arbiter between those two steps.
        let hasReplacedDifferentChoice = false;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          let pending;
          try {
            pending = await claimSubscriptionCheckoutIntent(
              intentClient,
              user.id,
              requestedChoice,
            );
          } catch (error: unknown) {
            if (error instanceof ExistingSubscriptionBlocksCheckoutError) {
              return { kind: "conflict" as const, alreadySubscribed: true };
            }
            throw error;
          }

          const isIdenticalChoice =
            pending.stripePriceId === requestedChoice.stripePriceId &&
            pending.planId === requestedChoice.planId &&
            pending.billingPeriod === requestedChoice.billingPeriod;

          if (pending.checkoutUrl && pending.stripeSessionId) {
            const current = await getCheckoutSessionStatus(
              user.id,
              pending.stripeSessionId,
            );
            if (current.status === "open") {
              if (!isIdenticalChoice) {
                if (hasReplacedDifferentChoice) {
                  return {
                    kind: "conflict" as const,
                    alreadySubscribed: false,
                    retryAt: pending.expiresAt,
                  };
                }
                await expireCheckoutSession(pending.stripeSessionId);
                await finishSubscriptionCheckoutIntent(
                  intentClient,
                  pending.id,
                  pending.stripeSessionId,
                  "expired",
                );
                hasReplacedDifferentChoice = true;
                continue;
              }
              return {
                kind: "conflict" as const,
                alreadySubscribed: false,
                session: {
                  sessionId: pending.stripeSessionId,
                  url: pending.checkoutUrl,
                },
              };
            }
            if (current.status !== "expired") {
              return {
                kind: "conflict" as const,
                alreadySubscribed: false,
                isCompleted: current.status === "complete",
              };
            }

            await finishSubscriptionCheckoutIntent(
              intentClient,
              pending.id,
              pending.stripeSessionId,
              "expired",
            );
            if (!isIdenticalChoice) hasReplacedDifferentChoice = true;
            continue;
          }

          const recovered = pending.isNew
            ? null
            : await findCheckoutSessionForIntent(
                user.id,
                user.email!,
                pending.id,
                typeof user.user_metadata?.name === "string"
                  ? user.user_metadata.name
                  : undefined,
                new Date(
                  Date.parse(pending.expiresAt) - SUBSCRIPTION_CHECKOUT_TTL_MS,
                ).toISOString(),
              );
          if (recovered) {
            await attachCheckoutSession(intentClient, pending.id, user.id, {
              sessionId: recovered.sessionId,
              url: recovered.url,
            });
            if (recovered.status === "expired") {
              await finishSubscriptionCheckoutIntent(
                intentClient,
                pending.id,
                recovered.sessionId,
                "expired",
              );
              if (!isIdenticalChoice) hasReplacedDifferentChoice = true;
              continue;
            }
            if (recovered.status === "open" && !isIdenticalChoice) {
              if (hasReplacedDifferentChoice) {
                return {
                  kind: "conflict" as const,
                  alreadySubscribed: false,
                  retryAt: pending.expiresAt,
                };
              }
              await expireCheckoutSession(recovered.sessionId);
              await finishSubscriptionCheckoutIntent(
                intentClient,
                pending.id,
                recovered.sessionId,
                "expired",
              );
              hasReplacedDifferentChoice = true;
              continue;
            }
            return {
              kind: "conflict" as const,
              alreadySubscribed: false,
              isCompleted: recovered.status === "complete",
              ...(recovered.url
                ? {
                    session: {
                      sessionId: recovered.sessionId,
                      url: recovered.url,
                    },
                  }
                : {}),
            };
          }

          if (new Date(pending.expiresAt).getTime() <= Date.now()) {
            await expireUnattachedSubscriptionCheckoutIntent(
              intentClient,
              pending.id,
              user.id,
            );
            continue;
          }

          // With no provider session to inspect, changing any part of the
          // immutable choice would reuse the old Stripe idempotency key with
          // different parameters. Stripe may already have accepted the old
          // request, so neither replacing nor releasing it is safe before the
          // reservation expires.
          if (!isIdenticalChoice) {
            return {
              kind: "conflict" as const,
              alreadySubscribed: false,
              retryAt: pending.expiresAt,
            };
          }

          // A reused unattached intent means a prior Stripe result was
          // ambiguous. Once less than Stripe's 30-minute expiry floor remains,
          // resending the immutable idempotent request would be rejected for
          // its old expires_at. Changing that value or key could create a
          // second payable session, so keep the intent closed until provider
          // recovery finds the original or the fixed deadline passes.
          if (
            !pending.isNew &&
            new Date(pending.expiresAt).getTime() - Date.now() <
              STRIPE_CHECKOUT_MIN_EXPIRY_MS
          ) {
            return {
              kind: "conflict" as const,
              alreadySubscribed: false,
              retryAt: pending.expiresAt,
            };
          }

          const limited = await enforceRateLimit(req, {
            limit: "CHECKOUT_USER",
            endpoint: "billing/checkout:new-session",
            identifier: user.id,
            identifierType: "user",
            // Ordinary subscription checkout remains available during a
            // Redis outage. Stripe/database idempotency still prevents a
            // second obligation; the outage is logged by enforceRateLimit.
            onStoreFailure: "allow",
            message: "Too many checkout attempts. Please try again later.",
          });
          if (limited) {
            // The fresh reservation is not scarce capacity and cannot be
            // expired until its durable deadline. Leaving it unattached lets
            // an allowed retry reuse the same Stripe idempotency key without
            // racing another isolate into a second session.
            return { kind: "limited" as const, response: limited };
          }

          // A provider error is ambiguous: Stripe may have accepted the
          // request. Nothing below releases the intent on error; the next
          // request searches Stripe by metadata before creating again.
          let session;
          try {
            session = await createCheckoutSession(
              user.id,
              user.email!,
              parsed.intent,
              typeof user.user_metadata?.name === "string"
                ? user.user_metadata.name
                : undefined,
              {
                pendingIntentId: pending.id,
                expiresAt: pending.expiresAt,
                priceId: requestedChoice.stripePriceId,
              },
            );
          } catch (error: unknown) {
            if (isStripeIdempotencyConflict(error)) {
              return {
                kind: "conflict" as const,
                alreadySubscribed: false,
                isCreating: true,
              };
            }
            throw error;
          }
          await attachCheckoutSession(
            intentClient,
            pending.id,
            user.id,
            session,
          );
          return { kind: "ok" as const, session };
        }

        return { kind: "conflict" as const, alreadySubscribed: false };
      });

      if (locked.kind === "limited") {
        return locked.response;
      }

      if (locked.kind === "recovery") {
        switch (locked.recovery.kind) {
          case "processing":
            return NextResponse.json(
              {
                error:
                  "A payment is still processing on your current subscription. We'll email you when it clears.",
              },
              { status: 409 },
            );
          case "resume":
            return NextResponse.json(
              {
                error:
                  "Your current subscription needs attention before you can start another checkout.",
                resumeUrl: locked.recovery.resumeUrl,
              },
              { status: 409 },
            );
          case "paused_without_portal":
            return NextResponse.json(
              {
                error:
                  "Your subscription is paused. Contact support to resume it before starting another checkout.",
              },
              { status: 409 },
            );
          case "unavailable":
            return NextResponse.json(
              {
                error:
                  "Your current subscription needs attention before another checkout can start. Contact support if no payment link is available.",
              },
              { status: 409 },
            );
          case "already_subscribed":
            return NextResponse.json(
              {
                error:
                  "You already have a subscription. Use the upgrade flow to change plans.",
              },
              { status: 409 },
            );
        }
      }

      if (locked.kind === "conflict") {
        const isCompleted =
          "isCompleted" in locked && locked.isCompleted === true;
        const isCreating = "isCreating" in locked && locked.isCreating === true;
        const retryAt = "retryAt" in locked ? locked.retryAt : undefined;
        const session = "session" in locked ? locked.session : undefined;
        return NextResponse.json(
          {
            error: locked.alreadySubscribed
              ? "You already have a subscription. Use the upgrade flow to change plans."
              : isCompleted
                ? "Your checkout completed, but your subscription is still being reconciled. Refresh shortly, or contact support if access does not appear."
                : isCreating
                  ? "A checkout is already being created. Please try again in a moment."
                  : retryAt
                    ? "Checkout recovery is still in progress. Try again after the current checkout expires."
                    : "You already have a checkout in progress. Finish or wait for it to expire.",
            ...(retryAt ? { retryAt } : {}),
            ...(session ? session : {}),
          },
          { status: 409 },
        );
      }

      return NextResponse.json(locked.session);
    }

    // Lifetime is bought once and never lapses, so a second purchase takes $199
    // for something the customer already owns outright — and the grant is
    // keyed on the payment intent, so the duplicate would not even be
    // deduplicated on the way back in: they would simply be $199 poorer.
    //
    // `LifetimeOfferCard` already hides the offer in this state, but that is a
    // rendering decision and this is a money decision. The subscription intent
    // above has always enforced its own precondition server-side rather than
    // trusting the dialog not to offer it; this is the same rule applied to the
    // more expensive product.
    if (parsed.intent.type === "lifetime") {
      const productId = parsed.intent.productId ?? "lifetime_pro";
      const product = await getOneTimeProduct(productId);
      const grantedPlanId = product.grantsPlanId;
      // The GRANT, not the effective plan. Asking `getEffectivePlanId` here
      // refused every Pro monthly subscriber — it falls back to a live
      // subscription when there is no grant, so a subscriber resolved to `pro`
      // and was told they already owned something they had never bought. That
      // is the customer most likely to want this, and the rest of the flow
      // (the offer card, the plan dialog, and the webhook that cancels their
      // subscription afterwards) all assume they can reach it.
      const heldGrants = await getGrantedPlanIds(user.id);

      if (
        productId === "lifetime_pro" &&
        existingSubscription?.plan_id === "agency"
      ) {
        return NextResponse.json(
          {
            error:
              "Lifetime Pro cannot replace an active Agency subscription. Keep Agency or contact support.",
          },
          { status: 409 },
        );
      }

      if (productId === "lifetime_pro" && heldGrants.includes("agency")) {
        return NextResponse.json(
          {
            error:
              "You already have Agency lifetime access, which includes Lifetime Pro benefits. There is nothing further to buy.",
          },
          { status: 409 },
        );
      }

      if (grantedPlanId !== null && heldGrants.includes(grantedPlanId)) {
        return NextResponse.json(
          {
            error:
              "You already have lifetime access to this plan. There is nothing further to buy.",
          },
          { status: 409 },
        );
      }

      if (productId === "lifetime_agency") {
        const buyerName =
          typeof user.user_metadata?.name === "string"
            ? user.user_metadata.name
            : undefined;

        const openCheckout = await getOpenFoundingAgencyCheckout(user.id);
        if (openCheckout) {
          return NextResponse.json(openCheckout);
        }

        const limited = await enforceRateLimit(req, {
          limit: "CHECKOUT_USER",
          endpoint: "billing/checkout:new-session",
          identifier: user.id,
          identifierType: "user",
          // Founding is the sole fail-closed checkout because an unmetered
          // request can consume one of the scarce capacity holds.
          onStoreFailure: "deny",
          message: "Too many checkout attempts. Please try again later.",
        });
        if (limited) return limited;

        // Configuration and customer failures are known before scarce
        // capacity is reserved. The user quota has already admitted this as a
        // new-session attempt, and an existing open session returned above.
        const prepared = await preflightLifetimeCheckout(
          user.id,
          user.email!,
          productId,
          buyerName,
        );

        await reconcileExpiredFoundingAgencyCheckouts();
        const reservation = await reserveFoundingAgencySpot(user.id);

        if (reservation.outcome === "owned") {
          return NextResponse.json(
            {
              error:
                "You already have lifetime Agency access. There is nothing further to buy.",
            },
            { status: 409 },
          );
        }

        if (reservation.outcome === "refunded") {
          return NextResponse.json(
            {
              error:
                "Your Founding Agency purchase was refunded or revoked. Limited founding spots are not reopened after a refund; contact support if this looks wrong.",
            },
            { status: 409 },
          );
        }

        if (reservation.outcome === "sold_out") {
          return NextResponse.json(
            {
              error: "All 50 Founding Agency lifetime spots are sold out.",
            },
            { status: 409 },
          );
        }

        if (reservation.outcome === "capacity_busy") {
          return NextResponse.json(
            {
              error:
                "The remaining Founding Agency spots are temporarily held in checkout. Please try again shortly.",
            },
            { status: 409 },
          );
        }

        if (reservation.outcome !== "reserved") {
          throw new Error("Unexpected Founding Agency reservation outcome");
        }

        let session;
        try {
          session = await createCheckoutSession(
            user.id,
            user.email!,
            {
              ...parsed.intent,
              reservationId: reservation.reservationId,
              checkoutExpiresAt: reservation.checkoutExpiresAt,
              prepared,
            },
            buyerName,
          );
        } catch (error: unknown) {
          // Invalid-request, authentication and permission errors reject the
          // request before Stripe creates a Checkout Session, so the unbound
          // hold can be released here. Connection, API, rate-limit and
          // idempotency errors can race a remote create and retain the hold for
          // recovery by the same key or by provider reconciliation at expiry.
          if (isDefinitiveStripeCreateFailure(error)) {
            await releaseFoundingAgencyCheckout(
              reservation.reservationId,
              user.id,
              null,
            );
          }
          throw error;
        }

        // A successful Stripe create with a failed bind is returned as 500.
        // The next request reuses both the database reservation and Stripe
        // idempotency key, recovers that same session, and retries this bind.
        // Releasing here would be unsafe: a customer may already be paying in
        // the remotely-created session while another buyer takes the spot.
        await bindFoundingAgencyCheckout(
          reservation.reservationId,
          user.id,
          session.sessionId,
          session.expiresAt ?? reservation.checkoutExpiresAt,
        );

        return NextResponse.json(session);
      }
    }

    const limited = await enforceRateLimit(req, {
      limit: "CHECKOUT_USER",
      endpoint: "billing/checkout:new-session",
      identifier: user.id,
      identifierType: "user",
      // Credits, payment methods and Lifetime Pro have durable provider-side
      // idempotency and no scarce hold, so a Redis outage is logged and allowed.
      onStoreFailure: "allow",
      message: "Too many checkout attempts. Please try again later.",
    });
    if (limited) return limited;

    const session = await createCheckoutSession(
      user.id,
      user.email!,
      parsed.intent,
      typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : undefined,
    );

    return NextResponse.json(session);
  } catch (error: unknown) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start checkout. Please try again.",
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/billing/checkout?session_id=cs_...
 * Read the outcome of a Checkout Session the current user started.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionId = new URL(req.url).searchParams.get("session_id");
    if (!sessionId) {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 },
      );
    }

    const status = await getCheckoutSessionStatus(user.id, sessionId);
    return NextResponse.json(status);
  } catch (error: unknown) {
    console.error("Error reading checkout session:", error);
    return NextResponse.json(
      { error: "Failed to read checkout session" },
      { status: 500 },
    );
  }
}
