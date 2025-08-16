/**
 * Create Edit Session API
 * POST /api/edit-sessions/create
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EditSessionManager } from '@/lib/auth/edit-sessions';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { siteId, permissions = ['edit'], durationHours = 2 } = body;

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    // Validate permissions array
    const validPermissions = ['view', 'edit', 'admin'];
    if (!Array.isArray(permissions) || !permissions.every(p => validPermissions.includes(p))) {
      return NextResponse.json(
        { error: 'Invalid permissions. Must be array of: view, edit, admin' },
        { status: 400 }
      );
    }

    // Validate duration
    if (typeof durationHours !== 'number' || durationHours < 0.5 || durationHours > 24) {
      return NextResponse.json(
        { error: 'Duration must be between 0.5 and 24 hours' },
        { status: 400 }
      );
    }

    // Get client IP and user agent
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Create edit session
    const editSession = await EditSessionManager.createEditSession({
      siteId,
      userId: user.id,
      permissions: permissions as ('view' | 'edit' | 'admin')[],
      durationHours,
      ipAddress,
      userAgent
    });

    if (!editSession) {
      return NextResponse.json(
        { error: 'Failed to create edit session. Check your site permissions.' },
        { status: 403 }
      );
    }

    // Get site information for response
    const { data: site } = await supabase
      .from('sites')
      .select('id, domain, name')
      .eq('id', siteId)
      .single();

    return NextResponse.json({
      success: true,
      session: {
        id: editSession.id,
        token: editSession.token,
        siteId: editSession.site_id,
        permissions: editSession.permissions,
        expiresAt: editSession.expires_at,
        site: site || null
      },
      editUrl: `${site?.domain}?rcf_edit_token=${editSession.token}`,
      message: 'Edit session created successfully'
    });

  } catch (error) {
    console.error('Error creating edit session:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}