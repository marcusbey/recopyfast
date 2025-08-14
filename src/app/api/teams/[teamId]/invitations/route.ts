import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { InviteTeamMemberPayload, TeamRole } from '@/types';

interface RouteContext {
  params: Promise<{ teamId: string }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { teamId } = await context.params;
    const supabase = await createServerClient();
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has permission to view invitations (manager or owner)
    const { data: membership, error: membershipError } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership || !['manager', 'owner'].includes(membership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Get pending invitations
    const { data: invitations, error } = await supabase
      .from('team_invitations')
      .select(`
        *,
        team:teams(name),
        inviter:auth.users!team_invitations_invited_by_fkey(
          email,
          raw_user_meta_data
        )
      `)
      .eq('team_id', teamId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString());

    if (error) {
      console.error('Error fetching invitations:', error);
      return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
    }

    return NextResponse.json({ invitations });
  } catch (error) {
    console.error('Error in invitations GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { teamId } = await context.params;
    const supabase = await createServerClient();
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: InviteTeamMemberPayload = await request.json();
    
    // Validate input
    if (!body.email || !body.role) {
      return NextResponse.json({ error: 'Email and role are required' }, { status: 400 });
    }

    const validRoles: TeamRole[] = ['viewer', 'editor', 'manager'];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Check if user has permission to invite (manager or owner)
    const { data: membership, error: membershipError } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership || !['manager', 'owner'].includes(membership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Check if team exists and get team info
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .select('id, name, max_members')
      .eq('id', teamId)
      .single();

    if (teamError || !team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    // Check current member count
    const { count: memberCount, error: countError } = await supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', teamId);

    if (countError) {
      return NextResponse.json({ error: 'Failed to check team capacity' }, { status: 500 });
    }

    if (memberCount !== null && memberCount >= team.max_members) {
      return NextResponse.json({ error: 'Team is at maximum capacity' }, { status: 400 });
    }

    // Check if user is already a member
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .single();

    if (existingMember) {
      return NextResponse.json({ error: 'User is already a team member' }, { status: 400 });
    }

    // Check if there's already a pending invitation
    const { data: existingInvitation } = await supabase
      .from('team_invitations')
      .select('id')
      .eq('team_id', teamId)
      .eq('email', body.email.toLowerCase())
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (existingInvitation) {
      return NextResponse.json({ error: 'Invitation already sent to this email' }, { status: 400 });
    }

    // Create invitation
    const { data: invitation, error } = await supabase
      .from('team_invitations')
      .insert({
        team_id: teamId,
        email: body.email.toLowerCase(),
        role: body.role,
        invited_by: user.id,
      })
      .select(`
        *,
        team:teams(name),
        inviter:auth.users!team_invitations_invited_by_fkey(
          email,
          raw_user_meta_data
        )
      `)
      .single();

    if (error) {
      console.error('Error creating invitation:', error);
      return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 });
    }

    // TODO: Send invitation email
    // await sendInvitationEmail(invitation);

    // Create notification for the inviter
    await supabase
      .from('collaboration_notifications')
      .insert({
        user_id: user.id,
        type: 'invitation',
        title: 'Invitation Sent',
        message: `Invitation sent to ${body.email} for team ${team.name}`,
        data: {
          invitation_id: invitation.id,
          team_id: teamId,
          email: body.email,
          role: body.role,
        },
      });

    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    console.error('Error in invitations POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}