import { stripe } from "./config";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { Customer } from "@/types/billing";

/** Postgres unique-violation. Two concurrent checkouts raced to enrol the user. */
const UNIQUE_VIOLATION = "23505";

/**
 * Create or retrieve a Stripe customer for a user.
 *
 * Writes go through the service-role client, not the caller's session. Every
 * billing table is user-readable and service-role-writable — see the policies
 * on billing_payment_methods and billing_invoices in
 * `20260611010000_rls_hardening.sql`, and `20260804120000` for this table.
 * Under the caller's token the INSERT below is rejected by RLS (42501), which
 * failed *every* checkout before it reached Stripe.
 *
 * `userId` is not caller-supplied: the route resolves it from the verified
 * session before calling in, so widening the client here does not widen who
 * can enrol whom.
 */
export async function createOrGetCustomer(
  userId: string,
  email: string,
  name?: string,
): Promise<{
  customer: Customer;
  stripeCustomer: import("stripe").Stripe.Customer;
}> {
  const supabase = createServiceRoleClient();

  const readCustomer = async (): Promise<Customer | null> => {
    const { data } = await supabase
      .from("billing_customers")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    return data;
  };

  const resolveStripeCustomer = async (customer: Customer) => {
    const retrieved = await stripe.customers.retrieve(
      customer.stripe_customer_id,
    );
    if (retrieved.deleted) {
      throw new Error("Stripe customer has been deleted");
    }
    return { customer, stripeCustomer: retrieved };
  };

  const existingCustomer = await readCustomer();
  if (existingCustomer) {
    return resolveStripeCustomer(existingCustomer);
  }

  const stripeCustomer = await stripe.customers.create({
    email,
    name,
    metadata: {
      user_id: userId,
    },
  });

  const { data: newCustomer, error } = await supabase
    .from("billing_customers")
    .insert({
      user_id: userId,
      stripe_customer_id: stripeCustomer.id,
      email,
      name,
    })
    .select()
    .single();

  if (!error) {
    return { customer: newCustomer, stripeCustomer };
  }

  // The row exists after all — a concurrent checkout won the race. Adopt its
  // customer and discard the duplicate we just opened at Stripe.
  if (error.code === UNIQUE_VIOLATION) {
    const raced = await readCustomer();
    if (raced) {
      await stripe.customers.del(stripeCustomer.id).catch(() => {});
      return resolveStripeCustomer(raced);
    }
  }

  // The Stripe customer is created before the row that records it, so a failed
  // write leaves one behind with nothing pointing at it. Retries then open a
  // fresh orphan every time. Take it back out rather than accumulate them.
  await stripe.customers.del(stripeCustomer.id).catch(() => {});

  throw new Error(`Failed to create customer: ${error.message}`);
}

/**
 * Update customer information
 */
export async function updateCustomer(
  customerId: string,
  updates: { email?: string; name?: string },
): Promise<Customer> {
  const supabase = await createClient();

  // Get the customer
  const { data: customer, error: fetchError } = await supabase
    .from("billing_customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (fetchError || !customer) {
    throw new Error("Customer not found");
  }

  // Update Stripe customer
  await stripe.customers.update(customer.stripe_customer_id, updates);

  // Update our database
  const { data: updatedCustomer, error } = await supabase
    .from("billing_customers")
    .update(updates)
    .eq("id", customerId)
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
export async function getCustomerByUserId(
  userId: string,
): Promise<Customer | null> {
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("billing_customers")
    .select("*")
    .eq("user_id", userId)
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
    .from("billing_customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (fetchError || !customer) {
    throw new Error("Customer not found");
  }

  // Delete from Stripe
  await stripe.customers.del(customer.stripe_customer_id);

  // Delete from our database (cascade will handle related records)
  const { error } = await supabase
    .from("billing_customers")
    .delete()
    .eq("id", customerId);

  if (error) {
    throw new Error(`Failed to delete customer: ${error.message}`);
  }
}
