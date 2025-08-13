import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { domain, name } = await request.json();
    
    if (!domain || !name) {
      return NextResponse.json(
        { error: 'Domain and name are required' },
        { status: 400 }
      );
    }
    
    const supabase = await createClient();
    
    // Check if domain already exists
    const { data: existingSite } = await supabase
      .from('sites')
      .select('id')
      .eq('domain', domain)
      .single();
    
    if (existingSite) {
      return NextResponse.json(
        { error: 'Domain already registered' },
        { status: 400 }
      );
    }
    
    // Generate API key
    const apiKey = crypto.randomBytes(32).toString('hex');
    
    // Create site
    const { data: site, error } = await supabase
      .from('sites')
      .insert({
        domain,
        name,
        api_key: apiKey
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating site:', error);
      return NextResponse.json(
        { error: 'Failed to create site' },
        { status: 500 }
      );
    }
    
    // Generate embed script
    const embedScript = `<script src="${process.env.NEXT_PUBLIC_APP_URL}/embed/recopyfast.js" data-site-id="${site.id}"></script>`;
    
    return NextResponse.json({
      site: {
        id: site.id,
        domain: site.domain,
        name: site.name,
        created_at: site.created_at
      },
      apiKey,
      embedScript
    });
  } catch (error) {
    console.error('Error in site registration:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}