import { stripe, TICKET_CONFIG } from './config';
import { createClient } from '@/lib/supabase/server';
import { createOrGetCustomer } from './customer';
import type { Tickets, TicketTransaction, TicketPurchaseRequest } from '@/types/billing';

/**
 * Purchase tickets for pay-per-use features
 */
export async function purchaseTickets(
  userId: string,
  email: string,
  request: TicketPurchaseRequest
): Promise<{ paymentIntent: any; tickets: Tickets }> {
  const supabase = await createClient();

  // Create or get customer
  const { customer, stripeCustomer } = await createOrGetCustomer(userId, email);

  // Calculate total amount
  const totalAmount = Math.round(request.quantity * TICKET_CONFIG.TICKETS_PER_PURCHASE * TICKET_CONFIG.PRICE_PER_TICKET * 100); // in cents
  const totalTickets = request.quantity * TICKET_CONFIG.TICKETS_PER_PURCHASE;

  // Create payment intent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalAmount,
    currency: 'usd',
    customer: stripeCustomer.id,
    payment_method: request.paymentMethodId,
    confirmation_method: 'manual',
    confirm: true,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing`,
    metadata: {
      user_id: userId,
      ticket_quantity: totalTickets.toString(),
      type: 'ticket_purchase',
    },
  });

  // If payment succeeded, add tickets
  if (paymentIntent.status === 'succeeded') {
    await addTicketsToUser(userId, totalTickets, paymentIntent.id);
  }

  // Get updated ticket balance
  const { data: tickets } = await supabase
    .from('tickets')
    .select('*')
    .eq('user_id', userId)
    .single();

  return { paymentIntent, tickets: tickets! };
}

/**
 * Add tickets to user's balance
 */
export async function addTicketsToUser(
  userId: string,
  ticketAmount: number,
  stripePaymentIntentId?: string
): Promise<Tickets> {
  const supabase = await createClient();

  // Use the database function to add tickets
  const { error } = await supabase.rpc('add_tickets', {
    user_uuid: userId,
    ticket_amount: ticketAmount,
    stripe_payment_intent_id_param: stripePaymentIntentId,
  });

  if (error) {
    throw new Error(`Failed to add tickets: ${error.message}`);
  }

  // Get updated tickets
  const { data: tickets, error: fetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (fetchError) {
    throw new Error(`Failed to fetch tickets: ${fetchError.message}`);
  }

  return tickets;
}

/**
 * Consume tickets for feature usage
 */
export async function consumeTickets(
  userId: string,
  ticketAmount: number,
  description: string = 'AI feature usage'
): Promise<boolean> {
  const supabase = await createClient();

  // Use the database function to consume tickets
  const { data: success, error } = await supabase.rpc('consume_tickets', {
    user_uuid: userId,
    ticket_amount: ticketAmount,
    description_text: description,
  });

  if (error) {
    throw new Error(`Failed to consume tickets: ${error.message}`);
  }

  return success;
}

/**
 * Get user's ticket balance
 */
export async function getUserTicketBalance(userId: string): Promise<number> {
  const supabase = await createClient();

  const { data: balance, error } = await supabase.rpc('get_user_ticket_balance', {
    user_uuid: userId,
  });

  if (error) {
    throw new Error(`Failed to get ticket balance: ${error.message}`);
  }

  return balance || 0;
}

/**
 * Get user's ticket information
 */
export async function getUserTickets(userId: string): Promise<Tickets | null> {
  const supabase = await createClient();

  const { data: tickets } = await supabase
    .from('tickets')
    .select('*')
    .eq('user_id', userId)
    .single();

  return tickets;
}

/**
 * Get user's ticket transaction history
 */
export async function getTicketTransactions(
  userId: string,
  limit: number = 50
): Promise<TicketTransaction[]> {
  const supabase = await createClient();

  const { data: transactions, error } = await supabase
    .from('ticket_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch ticket transactions: ${error.message}`);
  }

  return transactions || [];
}

/**
 * Refund tickets (for failed operations)
 */
export async function refundTickets(
  userId: string,
  ticketAmount: number,
  description: string = 'Refund for failed operation'
): Promise<Tickets> {
  const supabase = await createClient();

  // Get the user's ticket record
  const { data: ticketRecord, error: fetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (fetchError || !ticketRecord) {
    throw new Error('User ticket record not found');
  }

  // Update ticket balance
  const { data: updatedTickets, error: updateError } = await supabase
    .from('tickets')
    .update({
      balance: ticketRecord.balance + ticketAmount,
    })
    .eq('user_id', userId)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to refund tickets: ${updateError.message}`);
  }

  // Record the refund transaction
  await supabase
    .from('ticket_transactions')
    .insert({
      user_id: userId,
      ticket_id: ticketRecord.id,
      type: 'refund',
      amount: ticketAmount,
      description,
    });

  return updatedTickets;
}

/**
 * Check if user has enough tickets for an operation
 */
export async function checkTicketBalance(
  userId: string,
  requiredTickets: number
): Promise<{ hasEnough: boolean; currentBalance: number }> {
  const currentBalance = await getUserTicketBalance(userId);
  
  return {
    hasEnough: currentBalance >= requiredTickets,
    currentBalance,
  };
}

/**
 * Get ticket pricing information
 */
export function getTicketPricing() {
  return {
    pricePerTicket: TICKET_CONFIG.PRICE_PER_TICKET,
    ticketsPerPurchase: TICKET_CONFIG.TICKETS_PER_PURCHASE,
    totalPrice: TICKET_CONFIG.PRICE_PER_TICKET * TICKET_CONFIG.TICKETS_PER_PURCHASE,
    priceId: TICKET_CONFIG.PRICE_ID,
  };
}