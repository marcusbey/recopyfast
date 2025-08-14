import { NextRequest, NextResponse } from 'next/server';
import { analytics, getClientInfo } from '@/lib/analytics/tracker';
import { createServerClient } from '@supabase/ssr';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteId, metricType, value, metadata } = body;
    
    if (!siteId || !metricType || typeof value !== 'number') {
      return NextResponse.json(
        { error: 'Missing required fields: siteId, metricType, value' },
        { status: 400 }
      );
    }

    // Validate metric type
    const validMetricTypes = ['load_time', 'edit_time', 'api_response_time'];
    if (!validMetricTypes.includes(metricType)) {
      return NextResponse.json(
        { error: 'Invalid metric type' },
        { status: 400 }
      );
    }

    // Track the performance metric
    await analytics.trackPerformance({
      siteId,
      metricType,
      value,
      metadata
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Performance tracking error:', error);
    return NextResponse.json(
      { error: 'Failed to track performance' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const metricType = searchParams.get('metricType');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!siteId) {
      return NextResponse.json(
        { error: 'Missing required parameter: siteId' },
        { status: 400 }
      );
    }

    // Verify user has access to site
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

    const { data: permission } = await supabase
      .from('site_permissions')
      .select('id')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .single();

    if (!permission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Build query
    let query = supabase
      .from('performance_metrics')
      .select('*')
      .eq('site_id', siteId)
      .order('recorded_at', { ascending: false });

    if (metricType) {
      query = query.eq('metric_type', metricType);
    }

    if (startDate) {
      query = query.gte('recorded_at', startDate);
    }

    if (endDate) {
      query = query.lte('recorded_at', endDate);
    }

    const { data: metrics, error } = await query.limit(1000);

    if (error) {
      throw error;
    }

    // Calculate aggregated statistics
    const stats = {
      total_records: metrics?.length || 0,
      average_value: 0,
      min_value: 0,
      max_value: 0,
      percentile_95: 0
    };

    if (metrics && metrics.length > 0) {
      const values = metrics.map(m => m.value).sort((a, b) => a - b);
      stats.average_value = values.reduce((sum, val) => sum + val, 0) / values.length;
      stats.min_value = values[0];
      stats.max_value = values[values.length - 1];
      stats.percentile_95 = values[Math.floor(values.length * 0.95)];
    }

    return NextResponse.json({
      metrics,
      stats
    });
  } catch (error) {
    console.error('Performance fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch performance metrics' },
      { status: 500 }
    );
  }
}