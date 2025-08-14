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
    const eventType = searchParams.get('eventType');
    const severity = searchParams.get('severity');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query
    let query = supabase
      .from('security_events')
      .select(`
        *,
        sites(id, domain)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (siteId) {
      const sanitizedSiteId = validateAndSanitizeInput(siteId);
      
      // Check if user has permission to view this site's events
      const { data: sitePermission, error: permissionError } = await supabase
        .from('site_permissions')
        .select('permission')
        .eq('site_id', sanitizedSiteId)
        .eq('user_id', session.user.id)
        .single();

      if (permissionError || !sitePermission || sitePermission.permission !== 'admin') {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
      }

      query = query.eq('site_id', sanitizedSiteId);
    } else {
      // Only show events for sites the user has access to
      const { data: userSites } = await supabase
        .from('site_permissions')
        .select('site_id')
        .eq('user_id', session.user.id)
        .eq('permission', 'admin');

      if (userSites && userSites.length > 0) {
        const siteIds = userSites.map(s => s.site_id);
        query = query.in('site_id', siteIds);
      } else {
        // User has no sites, return empty result
        return NextResponse.json({ events: [], total: 0 });
      }
    }

    if (eventType) {
      const sanitizedEventType = validateAndSanitizeInput(eventType);
      query = query.eq('event_type', sanitizedEventType);
    }

    if (severity) {
      const sanitizedSeverity = validateAndSanitizeInput(severity);
      query = query.eq('severity', sanitizedSeverity);
    }

    const { data: events, error } = await query;

    if (error) {
      console.error('Security events fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch security events' }, { status: 500 });
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('security_events')
      .select('id', { count: 'exact', head: true });

    if (siteId) {
      countQuery = countQuery.eq('site_id', siteId);
    }
    if (eventType) {
      countQuery = countQuery.eq('event_type', eventType);
    }
    if (severity) {
      countQuery = countQuery.eq('severity', severity);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error('Security events count error:', countError);
    }

    return NextResponse.json({ 
      events: events || [], 
      total: count || 0,
      limit,
      offset
    });

  } catch (error) {
    console.error('Security events API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const body = await request.json();
    const { 
      eventType, 
      siteId, 
      userId, 
      ipAddress, 
      userAgent, 
      endpoint, 
      payload, 
      severity = 'medium' 
    } = body;

    // Validate required fields
    const sanitizedEventType = validateAndSanitizeInput(eventType);
    if (!sanitizedEventType) {
      return NextResponse.json({ error: 'Missing event type' }, { status: 400 });
    }

    // Validate event type
    const validEventTypes = ['rate_limit_exceeded', 'invalid_domain', 'xss_attempt', 'suspicious_activity'];
    if (!validEventTypes.includes(sanitizedEventType)) {
      return NextResponse.json({ error: 'Invalid event type' }, { status: 400 });
    }

    // Validate severity
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    const sanitizedSeverity = validateAndSanitizeInput(severity);
    if (!validSeverities.includes(sanitizedSeverity)) {
      return NextResponse.json({ error: 'Invalid severity level' }, { status: 400 });
    }

    // Sanitize optional fields
    const sanitizedSiteId = siteId ? validateAndSanitizeInput(siteId) : null;
    const sanitizedUserId = userId ? validateAndSanitizeInput(userId) : null;
    const sanitizedIpAddress = ipAddress ? validateAndSanitizeInput(ipAddress) : null;
    const sanitizedUserAgent = userAgent ? validateAndSanitizeInput(userAgent) : null;
    const sanitizedEndpoint = endpoint ? validateAndSanitizeInput(endpoint) : null;

    // Insert security event
    const { data: event, error: insertError } = await supabase
      .from('security_events')
      .insert([{
        event_type: sanitizedEventType,
        site_id: sanitizedSiteId,
        user_id: sanitizedUserId,
        ip_address: sanitizedIpAddress,
        user_agent: sanitizedUserAgent,
        endpoint: sanitizedEndpoint,
        payload: payload || null,
        severity: sanitizedSeverity
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Security event creation error:', insertError);
      return NextResponse.json({ error: 'Failed to log security event' }, { status: 500 });
    }

    return NextResponse.json({ 
      event,
      message: 'Security event logged successfully' 
    });

  } catch (error) {
    console.error('Security event logging API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}