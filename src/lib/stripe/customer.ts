import { stripe } from './config';
import { createClient } from '@/lib/supabase/server';
import type { Customer } from '@/types/billing';

/**
 * Create or retrieve a Stripe customer for a user
 */
export async function createOrGetCustomer(
  userId: string,
  email: string,
  name?: string
): Promise<{ customer: Customer; stripeCustomer: any }> {
  const supabase = await createClient();

  // Check if customer already exists in our database
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (existingCustomer) {
    // Get the Stripe customer
    const stripeCustomer = await stripe.customers.retrieve(
      existingCustomer.stripe_customer_id
    );
    return { customer: existingCustomer, stripeCustomer };
  }

  // Create new Stripe customer
  const stripeCustomer = await stripe.customers.create({
    email,
    name,
    metadata: {
      user_id: userId,
    },
  });

  // Save customer to our database
  const { data: newCustomer, error } = await supabase
    .from('customers')
    .insert({
      user_id: userId,
      stripe_customer_id: stripeCustomer.id,
      email,
      name,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create customer: ${error.message}`);
  }

  return { customer: newCustomer, stripeCustomer };
}

/**
 * Update customer information
 */
export async function updateCustomer(
  customerId: string,
  updates: { email?: string; name?: string }
): Promise<Customer> {
  const supabase = await createClient();

  // Get the customer
  const { data: customer, error: fetchError } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (fetchError || !customer) {
    throw new Error('Customer not found');
  }

  // Update Stripe customer
  await stripe.customers.update(customer.stripe_customer_id, updates);

  // Update our database
  const { data: updatedCustomer, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', customerId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update customer: ${error.message}`);
  }

  return updatedCustomer;
}

/**
 * Get customer by user ID
 */
export async function getCustomerByUserId(userId: string): Promise<Customer | null> {
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('user_id', userId)
    .single();

  return customer;
}

/**
 * Delete customer (for account deletion)
 */
export async function deleteCustomer(customerId: string): Promise<void> {
  const supabase = await createClient();

  // Get the customer
  const { data: customer, error: fetchError } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (fetchError || !customer) {
    throw new Error('Customer not found');
  }

  // Delete from Stripe
  await stripe.customers.del(customer.stripe_customer_id);

  // Delete from our database (cascade will handle related records)
  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('id', customerId);

  if (error) {
    throw new Error(`Failed to delete customer: ${error.message}`);
  }
}