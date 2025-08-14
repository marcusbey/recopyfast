import { NextRequest, NextResponse } from 'next/server';
import { analytics, getClientInfo } from '@/lib/analytics/tracker';
import { createServerClient } from '@supabase/ssr';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, siteId, resourceType, resourceId, metadata } = body;
    
    if (!action || !siteId) {
      return NextResponse.json(
        { error: 'Missing required fields: action, siteId' },
        { status: 400 }
      );
    }

    // Get client information
    const clientInfo = getClientInfo(req);

    // Get user ID from session
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    // Track the activity
    await analytics.trackActivity({
      userId: user?.id,
      siteId,
      actionType: action,
      resourceType,
      resourceId,
      metadata,
      ...clientInfo
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Analytics tracking error:', error);
    return NextResponse.json(
      { error: 'Failed to track analytics' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Verify user has access to site analytics
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has access to the site
    if (siteId) {
      const { data: permission } = await supabase
        .from('site_permissions')
        .select('id')
        .eq('site_id', siteId)
        .eq('user_id', user.id)
        .single();

      if (!permission) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const dateRange = startDate && endDate ? { start: startDate, end: endDate } : undefined;
    const dashboardData = await analytics.getDashboardData(siteId || undefined, dateRange);

    return NextResponse.json(dashboardData);
  } catch (error) {
    console.error('Analytics fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}