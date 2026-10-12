import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/config";
import {
  listPaymentMethods,
  setDefaultPaymentMethod,
} from "@/lib/stripe/payment-methods";
import { getCustomerByUserId } from "@/lib/stripe/customer";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { billingErrorResponse } from "@/lib/billing/billing-refusal";

/**
 * Payment methods are read straight from Stripe.
 *
 * Cards are attached by Stripe Checkout (subscription / setup mode), so there is
 * no reliable moment for us to mirror them into `billing_payment_methods`
 * ourselves — and the Stripe webhook does not sync that table. Treating Stripe
 * as the source of truth keeps the list correct no matter how a card arrived.
 */

/**
 * Per IP, before authorisation — AGENTS.md: `getUser()` is itself a lookup, so
 * a limiter behind it never sees the flood. One bucket for the three methods:
 * a person managing cards makes a handful of these calls a minute.
 *
 * Fails OPEN, like checkout's IP bucket (`billing/checkout/route.ts`). These
 * are a signed-in customer's own card operations, and Stripe meters its API
 * itself; the payment-method existence probe this limiter was asked for (s69
 * L5) is closed by `retrieveOwnedPaymentMethod` answering one 404, not by the
 * limiter. A Redis blip must not stop someone replacing a card that is failing
 * renewals.
 */
function limitPaymentMethodRequests(req: NextRequest) {
  return enforceRateLimit(req, {
    limit: "API_GENERAL",
    endpoint: "billing/payment-methods:ip",
    identifierType: "ip",
    onStoreFailure: "allow",
    // The card prints this, then "Try again at HH:MM." from the reset header
    // (PaymentMethodsCard, as checkout's 429 reads), so it names no time.
    message: "Too many payment method requests.",
  });
}

/** Stripe's answer to an id that does not exist. */
function isStripeResourceMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "resource_missing"
  );
}

/**
 * The payment method, when it exists AND belongs to this customer; otherwise
 * null, which the caller answers "Payment method not found".
 *
 * s82 (s69 L5): an unknown id made `retrieve` throw "No such PaymentMethod:
 * 'pm_…'", which reached the client as a 500 with that text, while another
 * customer's id answered 404 — two answers that told a caller which ids exist.
 * Only `resource_missing` folds into "not found"; any other Stripe failure
 * still throws, so an outage never reads as "you have no such card".
 */
async function retrieveOwnedPaymentMethod(
  paymentMethodId: string,
  stripeCustomerId: string,
) {
  try {
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    // Ownership check: never let one user point at another user's card.
    return paymentMethod.customer === stripeCustomerId ? paymentMethod : null;
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * GET /api/billing/payment-methods
 */
export async function GET(req: NextRequest) {
  try {
    const limited = await limitPaymentMethodRequests(req);
    if (limited) return limited;

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json({ paymentMethods: [] });
    }

    const paymentMethods = await listPaymentMethods(
      customer.id,
      customer.stripe_customer_id,
    );

    return NextResponse.json({ paymentMethods });
  } catch (error: unknown) {
    console.error("Error fetching payment methods:", error);
    return NextResponse.json(
      { error: "Failed to fetch payment methods" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/billing/payment-methods
 * Body: { paymentMethodId, setAsDefault? }
 *
 * Makes a card the customer's default for invoices and for their subscription.
 * Used both by the "Set default" button and by the return leg of the
 * setup-mode Checkout flow that adds a new card.
 */
export async function POST(req: NextRequest) {
  try {
    const limited = await limitPaymentMethodRequests(req);
    if (limited) return limited;

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { paymentMethodId, setAsDefault = true } = body;

    if (typeof paymentMethodId !== "string" || !paymentMethodId) {
      return NextResponse.json(
        { error: "Payment method ID is required" },
        { status: 400 },
      );
    }

    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json(
        { error: "No billing customer found for this account" },
        { status: 404 },
      );
    }

    const paymentMethod = await retrieveOwnedPaymentMethod(
      paymentMethodId,
      customer.stripe_customer_id,
    );
    if (!paymentMethod) {
      return NextResponse.json(
        { error: "Payment method not found" },
        { status: 404 },
      );
    }

    if (setAsDefault) {
      await setDefaultPaymentMethod(
        customer.stripe_customer_id,
        paymentMethodId,
      );
    }

    const paymentMethods = await listPaymentMethods(
      customer.id,
      customer.stripe_customer_id,
    );

    return NextResponse.json({ paymentMethods });
  } catch (error: unknown) {
    // Stripe's text stays in the log (s82, s69 L5) — see billing-refusal.ts.
    return billingErrorResponse(
      error,
      "Error updating payment method",
      "Failed to update payment method",
    );
  }
}

/**
 * DELETE /api/billing/payment-methods?paymentMethodId=pm_...
 */
export async function DELETE(req: NextRequest) {
  try {
    const limited = await limitPaymentMethodRequests(req);
    if (limited) return limited;

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const paymentMethodId = new URL(req.url).searchParams.get(
      "paymentMethodId",
    );

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: "Payment method ID is required" },
        { status: 400 },
      );
    }

    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json(
        { error: "Payment method not found" },
        { status: 404 },
      );
    }

    const paymentMethod = await retrieveOwnedPaymentMethod(
      paymentMethodId,
      customer.stripe_customer_id,
    );
    if (!paymentMethod) {
      return NextResponse.json(
        { error: "Payment method not found" },
        { status: 404 },
      );
    }

    const paymentMethods = await listPaymentMethods(
      customer.id,
      customer.stripe_customer_id,
    );
    const target = paymentMethods.find((pm) => pm.id === paymentMethodId);

    // Removing the default card would leave renewals with nothing to charge.
    if (target?.is_default && paymentMethods.length > 1) {
      return NextResponse.json(
        {
          error:
            "Cannot remove your default payment method. Set another card as default first.",
        },
        { status: 400 },
      );
    }

    // Detaching in Stripe is the whole operation. The legacy
    // `billing_payment_methods` mirror is not read anywhere and is writable
    // only by the service role, so there is nothing to clean up here.
    await stripe.paymentMethods.detach(paymentMethodId);

    const remaining = await listPaymentMethods(
      customer.id,
      customer.stripe_customer_id,
    );

    return NextResponse.json({ success: true, paymentMethods: remaining });
  } catch (error: unknown) {
    // Stripe's text stays in the log (s82, s69 L5) — see billing-refusal.ts.
    return billingErrorResponse(
      error,
      "Error removing payment method",
      "Failed to remove payment method",
    );
  }
}
