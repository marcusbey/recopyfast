import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateAndSanitizeInput } from '@/lib/security/content-sanitizer';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId');
    const timeframe = searchParams.get('timeframe') || '24h'; // 24h, 7d, 30d

    // Validate timeframe
    const validTimeframes = ['1h', '24h', '7d', '30d'];
    if (!validTimeframes.includes(timeframe)) {
      return NextResponse.json({ error: 'Invalid timeframe' }, { status: 400 });
    }

    // Calculate time range
    const now = new Date();
    let startTime: Date;
    
    switch (timeframe) {
      case '1h':
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    // Get user's sites for permission checking
    const { data: userSites } = await supabase
      .from('site_permissions')
      .select('site_id')
      .eq('user_id', session.user.id)
      .eq('permission', 'admin');

    if (!userSites || userSites.length === 0) {
      return NextResponse.json({
        totalEvents: 0,
        eventsByType: {},
        eventsBySeverity: {},
        recentEvents: [],
        rateLimitStats: {},
        topIPs: []
      });
    }

    const userSiteIds = userSites.map(s => s.site_id);

    // Build base query with site permissions
    let baseQuery = supabase
      .from('security_events')
      .select('*')
      .in('site_id', userSiteIds)
      .gte('created_at', startTime.toISOString());

    // Apply site filter if specified
    if (siteId) {
      const sanitizedSiteId = validateAndSanitizeInput(siteId);
      
      // Verify user has access to this specific site
      if (!userSiteIds.includes(sanitizedSiteId)) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
      }
      
      baseQuery = baseQuery.eq('site_id', sanitizedSiteId);
    }

    // Get all events for analysis
    const { data: events, error: eventsError } = await baseQuery.order('created_at', { ascending: false });

    if (eventsError) {
      console.error('Security events fetch error:', eventsError);
      return NextResponse.json({ error: 'Failed to fetch security events' }, { status: 500 });
    }

    // Analyze events
    const totalEvents = events?.length || 0;
    
    const eventsByType = events?.reduce((acc: Record<string, number>, event) => {
      acc[event.event_type] = (acc[event.event_type] || 0) + 1;
      return acc;
    }, {}) || {};

    const eventsBySeverity = events?.reduce((acc: Record<string, number>, event) => {
      acc[event.severity] = (acc[event.severity] || 0) + 1;
      return acc;
    }, {}) || {};

    const recentEvents = events?.slice(0, 10) || [];

    // Get rate limit specific stats
    const rateLimitEvents = events?.filter(e => e.event_type === 'rate_limit_exceeded') || [];
    const rateLimitStats = {
      total: rateLimitEvents.length,
      uniqueIPs: new Set(rateLimitEvents.map(e => e.ip_address).filter(Boolean)).size,
      uniqueEndpoints: new Set(rateLimitEvents.map(e => e.endpoint).filter(Boolean)).size
    };

    // Get top IPs by event count
    const ipCounts = events?.reduce((acc: Record<string, number>, event) => {
      if (event.ip_address) {
        acc[event.ip_address] = (acc[event.ip_address] || 0) + 1;
      }
      return acc;
    }, {}) || {};

    const topIPs = Object.entries(ipCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }));

    // Get domain verification stats
    const { data: domainStats, error: domainError } = await supabase
      .from('domain_verifications')
      .select('is_verified, verification_method')
      .in('site_id', userSiteIds);

    let domainVerificationStats = {};
    if (!domainError && domainStats) {
      domainVerificationStats = {
        total: domainStats.length,
        verified: domainStats.filter(d => d.is_verified).length,
        pending: domainStats.filter(d => !d.is_verified).length,
        byMethod: domainStats.reduce((acc: Record<string, number>, domain) => {
          acc[domain.verification_method] = (acc[domain.verification_method] || 0) + 1;
          return acc;
        }, {})
      };
    }

    // Get API key stats
    const { data: apiKeyStats, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('is_active, last_used_at')
      .in('site_id', userSiteIds);

    let apiKeyStatsData = {};
    if (!apiKeyError && apiKeyStats) {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      apiKeyStatsData = {
        total: apiKeyStats.length,
        active: apiKeyStats.filter(k => k.is_active).length,
        inactive: apiKeyStats.filter(k => !k.is_active).length,
        recentlyUsed: apiKeyStats.filter(k => 
          k.last_used_at && new Date(k.last_used_at) > oneWeekAgo
        ).length
      };
    }

    return NextResponse.json({
      timeframe,
      totalEvents,
      eventsByType,
      eventsBySeverity,
      recentEvents,
      rateLimitStats,
      topIPs,
      domainVerificationStats,
      apiKeyStats: apiKeyStatsData
    });

  } catch (error) {
    console.error('Security stats API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}