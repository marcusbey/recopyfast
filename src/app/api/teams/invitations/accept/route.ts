import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { AcceptInvitationPayload } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: AcceptInvitationPayload = await request.json();
    
    // Validate input
    if (!body.token) {
      return NextResponse.json({ error: 'Invitation token is required' }, { status: 400 });
    }

    // Get invitation
    const { data: invitation, error: invitationError } = await supabase
      .from('team_invitations')
      .select(`
        *,
        team:teams(
          id,
          name,
          max_members
        )
      `)
      .eq('token', body.token)
      .is('accepted_at', null)
      .single();

    if (invitationError || !invitation) {
      return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 404 });
    }

    // Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 });
    }

    // Check if the invitation email matches the current user's email
    if (invitation.email !== user.email) {
      return NextResponse.json({ error: 'Invitation is not for this user' }, { status: 403 });
    }

    // Check if user is already a member of this team
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', invitation.team_id)
      .eq('user_id', user.id)
      .single();

    if (existingMember) {
      return NextResponse.json({ error: 'User is already a member of this team' }, { status: 400 });
    }

    // Check current member count
    const { count: memberCount, error: countError } = await supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', invitation.team_id);

    if (countError) {
      return NextResponse.json({ error: 'Failed to check team capacity' }, { status: 500 });
    }

    if (memberCount !== null && memberCount >= invitation.team.max_members) {
      return NextResponse.json({ error: 'Team is at maximum capacity' }, { status: 400 });
    }

    // Start transaction: Add user to team and mark invitation as accepted
    const { error: memberError } = await supabase
      .from('team_members')
      .insert({
        team_id: invitation.team_id,
        user_id: user.id,
        role: invitation.role,
        invited_by: invitation.invited_by,
      });

    if (memberError) {
      console.error('Error adding team member:', memberError);
      return NextResponse.json({ error: 'Failed to join team' }, { status: 500 });
    }

    // Mark invitation as accepted
    const { error: updateError } = await supabase
      .from('team_invitations')
      .update({
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Error updating invitation:', updateError);
      // Don't fail here as the member was already added
    }

    // Create notification for the user
    await supabase
      .from('collaboration_notifications')
      .insert({
        user_id: user.id,
        type: 'team_update',
        title: 'Welcome to the Team!',
        message: `You have joined the team "${invitation.team.name}" as a ${invitation.role}`,
        data: {
          team_id: invitation.team_id,
          team_name: invitation.team.name,
          role: invitation.role,
        },
      });

    // Create notification for the inviter
    if (invitation.invited_by) {
      await supabase
        .from('collaboration_notifications')
        .insert({
          user_id: invitation.invited_by,
          type: 'team_update',
          title: 'Invitation Accepted',
          message: `${user.email} has joined your team "${invitation.team.name}"`,
          data: {
            team_id: invitation.team_id,
            team_name: invitation.team.name,
            new_member_email: user.email,
            role: invitation.role,
          },
        });
    }

    return NextResponse.json({ 
      message: 'Successfully joined team',
      team: invitation.team,
      role: invitation.role,
    });
  } catch (error) {
    console.error('Error in invitation accept:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}