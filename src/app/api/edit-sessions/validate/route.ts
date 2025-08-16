/**
 * Validate Edit Session API
 * POST /api/edit-sessions/validate
 */

import { NextRequest, NextResponse } from 'next/server';
import { EditSessionManager } from '@/lib/auth/edit-sessions';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, siteId } = body;

    if (!token || !siteId) {
      return NextResponse.json(
        { error: 'Token and site ID are required' },
        { status: 400 }
      );
    }

    // Get client IP for validation
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';

    // Validate edit session
    const editSession = await EditSessionManager.validateEditSession({
      token,
      siteId,
      ipAddress
    });

    if (!editSession) {
      return NextResponse.json(
        { 
          valid: false, 
          error: 'Invalid or expired edit session',
          requiresAuth: true 
        },
        { status: 401 }
      );
    }

    // Check if session is expiring soon (within 30 minutes)
    const now = Date.now();
    const expiresAt = editSession.expires_at.getTime();
    const timeRemaining = expiresAt - now;
    const isExpiringSoon = timeRemaining < (30 * 60 * 1000); // 30 minutes
    const timeRemainingMinutes = Math.max(0, Math.floor(timeRemaining / (60 * 1000)));

    return NextResponse.json({
      valid: true,
      session: {
        id: editSession.id,
        siteId: editSession.site_id,
        userId: editSession.user_id,
        permissions: editSession.permissions,
        expiresAt: editSession.expires_at,
        isExpiringSoon,
        timeRemainingMinutes
      },
      message: 'Edit session is valid'
    });

  } catch (error) {
    console.error('Error validating edit session:', error);
    return NextResponse.json(
      { 
        valid: false, 
        error: 'Internal server error',
        requiresAuth: true 
      },
      { status: 500 }
    );
  }
}