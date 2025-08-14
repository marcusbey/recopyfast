import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { UpdateTeamMemberRolePayload } from '@/types';

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

    // Check if user is a member of this team
    const { data: membership, error: membershipError } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'Not a member of this team' }, { status: 403 });
    }

    // Get all team members
    const { data: members, error } = await supabase
      .from('team_members')
      .select(`
        *,
        user:auth.users!team_members_user_id_fkey(
          email,
          raw_user_meta_data
        )
      `)
      .eq('team_id', teamId)
      .order('joined_at', { ascending: true });

    if (error) {
      console.error('Error fetching team members:', error);
      return NextResponse.json({ error: 'Failed to fetch team members' }, { status: 500 });
    }

    return NextResponse.json({ members });
  } catch (error) {
    console.error('Error in team members GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
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

    const body: UpdateTeamMemberRolePayload = await request.json();
    
    // Validate input
    if (!body.memberId || !body.role) {
      return NextResponse.json({ error: 'Member ID and role are required' }, { status: 400 });
    }

    const validRoles = ['viewer', 'editor', 'manager', 'owner'];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Check if current user has permission to update roles (manager or owner)
    const { data: currentUserMembership, error: membershipError } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !currentUserMembership || !['manager', 'owner'].includes(currentUserMembership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Get the member being updated
    const { data: targetMember, error: targetMemberError } = await supabase
      .from('team_members')
      .select('*, team:teams(owner_id)')
      .eq('id', body.memberId)
      .eq('team_id', teamId)
      .single();

    if (targetMemberError || !targetMember) {
      return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
    }

    // Prevent changing the team owner's role
    if (targetMember.team.owner_id === targetMember.user_id && body.role !== 'owner') {
      return NextResponse.json({ error: 'Cannot change team owner role' }, { status: 400 });
    }

    // Only owners can assign the owner role
    if (body.role === 'owner' && currentUserMembership.role !== 'owner') {
      return NextResponse.json({ error: 'Only team owners can assign owner role' }, { status: 403 });
    }

    // Managers cannot update other managers or owners (unless they're the owner)
    if (currentUserMembership.role === 'manager' && 
        ['manager', 'owner'].includes(targetMember.role) && 
        targetMember.user_id !== user.id) {
      return NextResponse.json({ error: 'Managers cannot update other managers or owners' }, { status: 403 });
    }

    // Update member role
    const { data: updatedMember, error } = await supabase
      .from('team_members')
      .update({ role: body.role })
      .eq('id', body.memberId)
      .select(`
        *,
        user:auth.users!team_members_user_id_fkey(
          email,
          raw_user_meta_data
        )
      `)
      .single();

    if (error) {
      console.error('Error updating member role:', error);
      return NextResponse.json({ error: 'Failed to update member role' }, { status: 500 });
    }

    // Create notification for the updated member
    await supabase
      .from('collaboration_notifications')
      .insert({
        user_id: targetMember.user_id,
        type: 'permission_change',
        title: 'Role Updated',
        message: `Your role has been updated to ${body.role}`,
        data: {
          team_id: teamId,
          old_role: targetMember.role,
          new_role: body.role,
          updated_by: user.id,
        },
      });

    return NextResponse.json({ member: updatedMember });
  } catch (error) {
    console.error('Error in team members PATCH:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
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

    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');

    if (!memberId) {
      return NextResponse.json({ error: 'Member ID is required' }, { status: 400 });
    }

    // Check if current user has permission to remove members (manager or owner)
    const { data: currentUserMembership, error: membershipError } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !currentUserMembership || !['manager', 'owner'].includes(currentUserMembership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Get the member being removed
    const { data: targetMember, error: targetMemberError } = await supabase
      .from('team_members')
      .select('*, team:teams(owner_id)')
      .eq('id', memberId)
      .eq('team_id', teamId)
      .single();

    if (targetMemberError || !targetMember) {
      return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
    }

    // Prevent removing the team owner
    if (targetMember.team.owner_id === targetMember.user_id) {
      return NextResponse.json({ error: 'Cannot remove team owner' }, { status: 400 });
    }

    // Managers cannot remove other managers or owners
    if (currentUserMembership.role === 'manager' && 
        ['manager', 'owner'].includes(targetMember.role)) {
      return NextResponse.json({ error: 'Managers cannot remove other managers or owners' }, { status: 403 });
    }

    // Remove member
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('id', memberId);

    if (error) {
      console.error('Error removing team member:', error);
      return NextResponse.json({ error: 'Failed to remove team member' }, { status: 500 });
    }

    // Create notification for the removed member
    await supabase
      .from('collaboration_notifications')
      .insert({
        user_id: targetMember.user_id,
        type: 'team_update',
        title: 'Removed from Team',
        message: `You have been removed from the team`,
        data: {
          team_id: teamId,
          removed_by: user.id,
        },
      });

    return NextResponse.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('Error in team members DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}