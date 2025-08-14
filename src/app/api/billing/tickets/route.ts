import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { 
  purchaseTickets, 
  getUserTickets, 
  getTicketTransactions,
  getTicketPricing 
} from '@/lib/stripe/tickets';

/**
 * GET /api/billing/tickets
 * Get user's ticket information and transaction history
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const includeTransactions = url.searchParams.get('includeTransactions') === 'true';
    const limit = parseInt(url.searchParams.get('limit') || '50');

    const tickets = await getUserTickets(user.id);
    const pricing = getTicketPricing();

    let transactions = [];
    if (includeTransactions) {
      transactions = await getTicketTransactions(user.id, limit);
    }

    return NextResponse.json({
      tickets,
      transactions,
      pricing,
    });
  } catch (error: any) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tickets' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/billing/tickets
 * Purchase tickets
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
    const { quantity, paymentMethodId } = body;

    // Validate quantity
    if (!quantity || quantity < 1 || quantity > 100) {
      return NextResponse.json(
        { error: 'Invalid quantity. Must be between 1 and 100.' },
        { status: 400 }
      );
    }

    const result = await purchaseTickets(user.id, user.email!, {
      quantity,
      paymentMethodId,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error purchasing tickets:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to purchase tickets' },
      { status: 500 }
    );
  }
}