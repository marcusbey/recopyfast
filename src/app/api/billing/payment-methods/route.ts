import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/config";
import {
  listPaymentMethods,
  setDefaultPaymentMethod,
} from "@/lib/stripe/payment-methods";
import { getCustomerByUserId } from "@/lib/stripe/customer";

/**
 * Payment methods are read straight from Stripe.
 *
 * Cards are attached by Stripe Checkout (subscription / setup mode), so there is
 * no reliable moment for us to mirror them into `billing_payment_methods`
 * ourselves — and the Stripe webhook does not sync that table. Treating Stripe
 * as the source of truth keeps the list correct no matter how a card arrived.
 */

/**
 * GET /api/billing/payment-methods
 */
export async function GET() {
  try {
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

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    // Ownership check: never let one user point at another user's card.
    if (paymentMethod.customer !== customer.stripe_customer_id) {
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
    console.error("Error updating payment method:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update payment method",
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/billing/payment-methods?paymentMethodId=pm_...
 */
export async function DELETE(req: NextRequest) {
  try {
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

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    if (paymentMethod.customer !== customer.stripe_customer_id) {
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
    console.error("Error removing payment method:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to remove payment method",
      },
      { status: 500 },
    );
  }
}
