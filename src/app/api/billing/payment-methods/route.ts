import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe/config';
import { createOrGetCustomer } from '@/lib/stripe/customer';

/**
 * GET /api/billing/payment-methods
 * Get user's payment methods
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get customer
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!customer) {
      return NextResponse.json({ paymentMethods: [] });
    }

    // Get payment methods from Stripe
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer.stripe_customer_id,
      type: 'card',
    });

    // Get payment methods from our database
    const { data: dbPaymentMethods } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false });

    // Merge Stripe and database data
    const combinedPaymentMethods = paymentMethods.data.map(pm => {
      const dbPm = dbPaymentMethods?.find(dbPm => dbPm.stripe_payment_method_id === pm.id);
      return {
        id: pm.id,
        type: pm.type,
        card: pm.card,
        is_default: dbPm?.is_default || false,
        created: pm.created,
      };
    });

    return NextResponse.json({ paymentMethods: combinedPaymentMethods });
  } catch (error: any) {
    console.error('Error fetching payment methods:', error);
    return NextResponse.json(
      { error: 'Failed to fetch payment methods' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/billing/payment-methods
 * Add a new payment method
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { paymentMethodId, setAsDefault } = body;

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: 'Payment method ID is required' },
        { status: 400 }
      );
    }

    // Create or get customer
    const { customer, stripeCustomer } = await createOrGetCustomer(
      user.id,
      user.email!,
      user.user_metadata?.name
    );

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: stripeCustomer.id,
    });

    // Get the payment method details
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    // Save to our database
    const { data: newPaymentMethod, error } = await supabase
      .from('payment_methods')
      .insert({
        customer_id: customer.id,
        stripe_payment_method_id: paymentMethodId,
        type: paymentMethod.type,
        brand: paymentMethod.card?.brand,
        last4: paymentMethod.card?.last4,
        exp_month: paymentMethod.card?.exp_month,
        exp_year: paymentMethod.card?.exp_year,
        is_default: setAsDefault || false,
      })
      .select()
      .single();

    if (error) {
      // Rollback: detach payment method
      await stripe.paymentMethods.detach(paymentMethodId);
      throw new Error(`Failed to save payment method: ${error.message}`);
    }

    // Set as default if requested
    if (setAsDefault) {
      // Remove default from other payment methods
      await supabase
        .from('payment_methods')
        .update({ is_default: false })
        .eq('customer_id', customer.id)
        .neq('id', newPaymentMethod.id);

      // Update customer's default payment method in Stripe
      await stripe.customers.update(stripeCustomer.id, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    }

    return NextResponse.json({ paymentMethod: newPaymentMethod });
  } catch (error: any) {
    console.error('Error adding payment method:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to add payment method' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/billing/payment-methods
 * Remove a payment method
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const paymentMethodId = url.searchParams.get('paymentMethodId');

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: 'Payment method ID is required' },
        { status: 400 }
      );
    }

    // Get the payment method from our database
    const { data: paymentMethod } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('stripe_payment_method_id', paymentMethodId)
      .single();

    if (!paymentMethod) {
      return NextResponse.json(
        { error: 'Payment method not found' },
        { status: 404 }
      );
    }

    // Check if this is the default payment method
    if (paymentMethod.is_default) {
      return NextResponse.json(
        { error: 'Cannot delete default payment method. Set another as default first.' },
        { status: 400 }
      );
    }

    // Detach from Stripe
    await stripe.paymentMethods.detach(paymentMethodId);

    // Remove from our database
    await supabase
      .from('payment_methods')
      .delete()
      .eq('stripe_payment_method_id', paymentMethodId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error removing payment method:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to remove payment method' },
      { status: 500 }
    );
  }
}