import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/stripe/subscription';
import { getUserTickets } from '@/lib/stripe/tickets';
import type { BillingDashboardData } from '@/types/billing';

/**
 * GET /api/billing/dashboard
 * Get comprehensive billing dashboard data
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get customer information
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // Get subscription
    const subscription = await getUserSubscription(user.id);

    // Get payment methods
    const { data: paymentMethods } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('customer_id', customer?.id)
      .order('created_at', { ascending: false });

    // Get recent invoices
    const { data: invoices } = await supabase
      .from('invoices')
      .select('*')
      .eq('customer_id', customer?.id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Get ticket information
    const tickets = await getUserTickets(user.id);

    // Get recent ticket transactions
    const { data: recentTransactions } = await supabase
      .from('ticket_transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Get current usage statistics
    const { data: usageData } = await supabase
      .from('usage_tracking')
      .select('feature_type, count')
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()); // Last 30 days

    // Calculate current usage
    const currentUsage = {
      websites: 0,
      collaborators: 0,
      aiUsage: 0,
      translations: 0,
    };

    // Count websites
    const { count: websiteCount } = await supabase
      .from('sites')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    currentUsage.websites = websiteCount || 0;

    // Aggregate usage from tracking data
    usageData?.forEach(usage => {
      switch (usage.feature_type) {
        case 'ai_suggestion':
          currentUsage.aiUsage += usage.count;
          break;
        case 'translation':
          currentUsage.translations += usage.count;
          break;
        case 'collaboration':
          currentUsage.collaborators = Math.max(currentUsage.collaborators, usage.count);
          break;
      }
    });

    const dashboardData: BillingDashboardData = {
      customer: customer || undefined,
      subscription: subscription || undefined,
      paymentMethods: paymentMethods || [],
      invoices: invoices || [],
      tickets: tickets || undefined,
      recentTransactions: recentTransactions || [],
      currentUsage,
    };

    return NextResponse.json(dashboardData);
  } catch (error: any) {
    console.error('Error fetching billing dashboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch billing dashboard' },
      { status: 500 }
    );
  }
}