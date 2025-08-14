import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { reactivateSubscription } from '@/lib/stripe/subscription';

/**
 * POST /api/billing/subscription/reactivate
 * Reactivate a canceled subscription
 */
export async function POST() {
  try {
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscription = await reactivateSubscription(user.id);

    return NextResponse.json({ subscription });
  } catch (error: any) {
    console.error('Error reactivating subscription:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to reactivate subscription' },
      { status: 500 }
    );
  }
}