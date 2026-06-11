import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { stripe, STRIPE_CONFIG } from "@/lib/stripe/config";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { addTicketsToUser } from "@/lib/stripe/tickets";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature") as string;

  let event: any;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      STRIPE_CONFIG.WEBHOOK_SECRET,
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
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
    // Fail open: continue processing rather than blocking on a DB error.
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
        await handleSubscriptionCreated(event.data.object, supabase);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object, supabase);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object, supabase);
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event.data.object, supabase);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object, supabase);
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object);
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
  } catch (error: any) {
    // A unique-violation means a concurrent delivery already processed this
    // event. Return 200 so Stripe stops retrying — the work is already done.
    if (error?.code === "23505") {
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

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreated(
  subscription: any,
  supabase: ServiceClient,
) {
  const userId = subscription.metadata?.user_id;

  if (!userId) {
    console.error("No user_id in subscription metadata");
    return;
  }

  // Get customer from billing_customers
  const { data: customer } = await supabase
    .from("billing_customers")
    .select("*")
    .eq("stripe_customer_id", subscription.customer)
    .single();

  if (!customer) {
    console.error("Customer not found for subscription");
    return;
  }

  // Insert or update subscription — use actual migration column names:
  // plan (not plan_id), cancel_at (not cancel_at_period_end)
  await supabase.from("billing_subscriptions").upsert({
    user_id: userId,
    customer_id: customer.id,
    stripe_subscription_id: subscription.id,
    plan: subscription.metadata?.plan_id || "pro",
    status: subscription.status,
    current_period_start: new Date(
      subscription.current_period_start * 1000,
    ).toISOString(),
    current_period_end: new Date(
      subscription.current_period_end * 1000,
    ).toISOString(),
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
  });
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdated(
  subscription: any,
  supabase: ServiceClient,
) {
  await supabase
    .from("billing_subscriptions")
    .update({
      plan: subscription.metadata?.plan_id || "pro",
      status: subscription.status,
      current_period_start: new Date(
        subscription.current_period_start * 1000,
      ).toISOString(),
      current_period_end: new Date(
        subscription.current_period_end * 1000,
      ).toISOString(),
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
}

/**
 * Handle subscription deletion
 */
async function handleSubscriptionDeleted(
  subscription: any,
  supabase: ServiceClient,
) {
  await supabase
    .from("billing_subscriptions")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);
}

/**
 * Handle successful invoice payment
 */
async function handleInvoicePaymentSucceeded(
  invoice: any,
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

  // Get subscription if exists
  const { data: subscription } = await supabase
    .from("billing_subscriptions")
    .select("*")
    .eq("stripe_subscription_id", invoice.subscription)
    .single();

  // Insert or update invoice
  await supabase.from("billing_invoices").upsert({
    customer_id: customer.id,
    subscription_id: subscription?.id,
    stripe_invoice_id: invoice.id,
    amount_paid: invoice.amount_paid,
    amount_due: invoice.amount_due,
    currency: invoice.currency,
    status: invoice.status,
    hosted_invoice_url: invoice.hosted_invoice_url,
    invoice_pdf: invoice.invoice_pdf,
  });
}

/**
 * Handle failed invoice payment
 */
async function handleInvoicePaymentFailed(
  invoice: any,
  supabase: ServiceClient,
) {
  // Update invoice status
  await supabase
    .from("billing_invoices")
    .update({
      status: invoice.status,
    })
    .eq("stripe_invoice_id", invoice.id);

  // TODO: Send notification to user about failed payment
  // TODO: Implement dunning management
}

/**
 * Handle successful payment intent (for ticket purchases).
 * Tickets are ONLY credited here (in the webhook) to avoid double-crediting
 * from the synchronous purchase path in tickets.ts.
 */
async function handlePaymentIntentSucceeded(paymentIntent: any) {
  if (paymentIntent.metadata?.type === "ticket_purchase") {
    const userId = paymentIntent.metadata.user_id;
    const ticketQuantity = parseInt(paymentIntent.metadata.ticket_quantity);

    if (userId && ticketQuantity) {
      await addTicketsToUser(userId, ticketQuantity, paymentIntent.id);
    }
  }
}

/**
 * Handle failed payment intent
 */
async function handlePaymentIntentFailed(paymentIntent: any) {
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
async function handleCustomerCreated(customer: any) {
  // Customer is already created in our system before the Stripe customer
  // This webhook is mainly for logging and verification
  console.log("Customer created in Stripe:", customer.id);
}

/**
 * Handle customer updates
 */
async function handleCustomerUpdated(customer: any, supabase: ServiceClient) {
  // Update customer information
  await supabase
    .from("billing_customers")
    .update({
      email: customer.email,
      name: customer.name,
    })
    .eq("stripe_customer_id", customer.id);
}

/**
 * Log billing events for audit trail
 */
async function logBillingEvent(event: any, supabase: ServiceClient) {
  // Extract user_id from event metadata
  let userId = null;
  if (event.data.object.metadata?.user_id) {
    userId = event.data.object.metadata.user_id;
  } else if (event.data.object.customer) {
    // Try to get user_id from customer
    const { data: customer } = await supabase
      .from("billing_customers")
      .select("user_id")
      .eq("stripe_customer_id", event.data.object.customer)
      .single();
    userId = customer?.user_id;
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
