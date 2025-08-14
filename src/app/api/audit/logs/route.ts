import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { auditLogger } from '@/lib/audit/logger';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const resourceType = searchParams.get('resourceType');
    const resourceId = searchParams.get('resourceId');
    const action = searchParams.get('action');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

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

    // Check if user has admin role or appropriate permissions
    const { data: userProfile } = await supabase
      .from('auth.users')
      .select('raw_user_meta_data')
      .eq('id', user.id)
      .single();

    const isAdmin = userProfile?.raw_user_meta_data?.role === 'admin';

    if (!isAdmin) {
      // Non-admin users can only see their own audit logs
      const { logs, total } = await auditLogger.getLogs({
        userId: user.id,
        resourceType,
        resourceId,
        action,
        startDate,
        endDate,
        limit,
        offset
      });

      return NextResponse.json({ logs, total });
    }

    // Admin users can see all logs with filters
    const { logs, total } = await auditLogger.getLogs({
      resourceType,
      resourceId,
      action,
      startDate,
      endDate,
      limit,
      offset
    });

    return NextResponse.json({ logs, total });
  } catch (error) {
    console.error('Get audit logs error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, resourceType, resourceId, metadata } = body;

    if (!action || !resourceType) {
      return NextResponse.json(
        { error: 'Missing required fields: action, resourceType' },
        { status: 400 }
      );
    }

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
    
    // Extract client info
    const forwarded = req.headers.get('x-forwarded-for');
    const ipAddress = forwarded ? forwarded.split(',')[0] : req.ip;
    const userAgent = req.headers.get('user-agent');

    await auditLogger.log({
      userId: user?.id,
      action,
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      metadata
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Log audit event error:', error);
    return NextResponse.json(
      { error: 'Failed to log audit event' },
      { status: 500 }
    );
  }
}