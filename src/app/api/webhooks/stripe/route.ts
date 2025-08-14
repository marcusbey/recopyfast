import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { stripe, STRIPE_CONFIG } from '@/lib/stripe/config';
import { createClient } from '@/lib/supabase/server';
import { addTicketsToUser } from '@/lib/stripe/tickets';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = (await headers()).get('stripe-signature') as string;

  let event: any;

  try {
    event = stripe.webhooks.constructEvent(body, signature, STRIPE_CONFIG.WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
  }

  console.log('Processing Stripe webhook:', event.type);

  try {
    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
      
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;
      
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;
      
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;
      
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object);
        break;
      
      case 'customer.created':
        await handleCustomerCreated(event.data.object);
        break;
      
      case 'customer.updated':
        await handleCustomerUpdated(event.data.object);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Log the event for audit trail
    await logBillingEvent(event);

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Error processing webhook' },
      { status: 500 }
    );
  }
}

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreated(subscription: any) {
  const supabase = await createClient();
  const userId = subscription.metadata?.user_id;

  if (!userId) {
    console.error('No user_id in subscription metadata');
    return;
  }

  // Get customer
  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('stripe_customer_id', subscription.customer)
    .single();

  if (!customer) {
    console.error('Customer not found for subscription');
    return;
  }

  // Insert or update subscription
  await supabase
    .from('subscriptions')
    .upsert({
      user_id: userId,
      customer_id: customer.id,
      stripe_subscription_id: subscription.id,
      plan_id: subscription.metadata?.plan_id || 'pro',
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
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
async function handleSubscriptionUpdated(subscription: any) {
  const supabase = await createClient();

  await supabase
    .from('subscriptions')
    .update({
      plan_id: subscription.metadata?.plan_id || 'pro',
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
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
    .eq('stripe_subscription_id', subscription.id);
}

/**
 * Handle subscription deletion
 */
async function handleSubscriptionDeleted(subscription: any) {
  const supabase = await createClient();

  await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id);
}

/**
 * Handle successful invoice payment
 */
async function handleInvoicePaymentSucceeded(invoice: any) {
  const supabase = await createClient();

  // Get customer
  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('stripe_customer_id', invoice.customer)
    .single();

  if (!customer) {
    console.error('Customer not found for invoice');
    return;
  }

  // Get subscription if exists
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('stripe_subscription_id', invoice.subscription)
    .single();

  // Insert or update invoice
  await supabase
    .from('invoices')
    .upsert({
      customer_id: customer.id,
      subscription_id: subscription?.id,
      stripe_invoice_id: invoice.id,
      amount_paid: invoice.amount_paid,
      amount_due: invoice.amount_due,
      currency: invoice.currency,
      status: invoice.status,
      hosted_invoice_url: invoice.hosted_invoice_url,
      invoice_pdf: invoice.invoice_pdf,
      period_start: invoice.period_start 
        ? new Date(invoice.period_start * 1000).toISOString() 
        : null,
      period_end: invoice.period_end 
        ? new Date(invoice.period_end * 1000).toISOString() 
        : null,
      due_date: invoice.due_date 
        ? new Date(invoice.due_date * 1000).toISOString() 
        : null,
      paid_at: invoice.status_transitions?.paid_at 
        ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() 
        : null,
    });
}

/**
 * Handle failed invoice payment
 */
async function handleInvoicePaymentFailed(invoice: any) {
  const supabase = await createClient();

  // Update invoice status
  await supabase
    .from('invoices')
    .update({
      status: invoice.status,
    })
    .eq('stripe_invoice_id', invoice.id);

  // TODO: Send notification to user about failed payment
  // TODO: Implement dunning management
}

/**
 * Handle successful payment intent (for ticket purchases)
 */
async function handlePaymentIntentSucceeded(paymentIntent: any) {
  if (paymentIntent.metadata?.type === 'ticket_purchase') {
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
  console.error('Payment intent failed:', paymentIntent.id, paymentIntent.last_payment_error);
  
  // TODO: Send notification to user about failed payment
  // TODO: Implement retry logic if appropriate
}

/**
 * Handle customer creation
 */
async function handleCustomerCreated(customer: any) {
  // Customer is already created in our system before the Stripe customer
  // This webhook is mainly for logging and verification
  console.log('Customer created in Stripe:', customer.id);
}

/**
 * Handle customer updates
 */
async function handleCustomerUpdated(customer: any) {
  const supabase = await createClient();

  // Update customer information
  await supabase
    .from('customers')
    .update({
      email: customer.email,
      name: customer.name,
    })
    .eq('stripe_customer_id', customer.id);
}

/**
 * Log billing events for audit trail
 */
async function logBillingEvent(event: any) {
  const supabase = await createClient();

  // Extract user_id from event metadata
  let userId = null;
  if (event.data.object.metadata?.user_id) {
    userId = event.data.object.metadata.user_id;
  } else if (event.data.object.customer) {
    // Try to get user_id from customer
    const { data: customer } = await supabase
      .from('customers')
      .select('user_id')
      .eq('stripe_customer_id', event.data.object.customer)
      .single();
    userId = customer?.user_id;
  }

  if (userId) {
    await supabase
      .from('billing_events')
      .insert({
        user_id: userId,
        event_type: event.type,
        stripe_event_id: event.id,
        data: event.data,
        processed: true,
      });
  }
}