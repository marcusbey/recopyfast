import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { CreateTeamPayload, Team } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get teams where user is a member
    const { data: teams, error } = await supabase
      .from('teams')
      .select(`
        *,
        team_members!inner(
          role,
          joined_at
        )
      `)
      .eq('team_members.user_id', user.id);

    if (error) {
      console.error('Error fetching teams:', error);
      return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
    }

    return NextResponse.json({ teams });
  } catch (error) {
    console.error('Error in teams GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: CreateTeamPayload = await request.json();
    
    // Validate input
    if (!body.name || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'Team name is required' }, { status: 400 });
    }

    if (body.name.length > 100) {
      return NextResponse.json({ error: 'Team name must be less than 100 characters' }, { status: 400 });
    }

    // Create team
    const { data: team, error } = await supabase
      .from('teams')
      .insert({
        name: body.name.trim(),
        description: body.description?.trim() || null,
        owner_id: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating team:', error);
      return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
    }

    return NextResponse.json({ team }, { status: 201 });
  } catch (error) {
    console.error('Error in teams POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}