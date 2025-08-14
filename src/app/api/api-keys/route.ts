import { NextRequest, NextResponse } from 'next/server';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import { validateAndSanitizeInput } from '@/lib/security/content-sanitizer';

interface ApiKeyRequest {
  siteId: string;
  name: string;
  requestsPerMinute?: number;
  requestsPerHour?: number;
  requestsPerDay?: number;
}

function generateApiKey(): { key: string; hash: string } {
  const key = `rcp_${randomBytes(32).toString('hex')}`;
  const hash = createHash('sha256').update(key).digest('hex');
  return { key, hash };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    
    // Check authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: ApiKeyRequest = await request.json();
    const { siteId, name, requestsPerMinute = 60, requestsPerHour = 1000, requestsPerDay = 10000 } = body;

    // Validate and sanitize inputs
    const sanitizedSiteId = validateAndSanitizeInput(siteId);
    const sanitizedName = validateAndSanitizeInput(name);

    if (!sanitizedSiteId || !sanitizedName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check if user has admin permission for this site
    const { data: sitePermission, error: permissionError } = await supabase
      .from('site_permissions')
      .select('permission')
      .eq('site_id', sanitizedSiteId)
      .eq('user_id', session.user.id)
      .single();

    if (permissionError || !sitePermission || sitePermission.permission !== 'admin') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Generate API key
    const { key, hash } = generateApiKey();

    // Insert API key into database
    const { data: apiKey, error: insertError } = await supabase
      .from('api_keys')
      .insert([{
        site_id: sanitizedSiteId,
        key_hash: hash,
        name: sanitizedName,
        requests_per_minute: requestsPerMinute,
        requests_per_hour: requestsPerHour,
        requests_per_day: requestsPerDay,
        is_active: true
      }])
      .select()
      .single();

    if (insertError) {
      console.error('API key creation error:', insertError);
      return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
    }

    // Return the API key (only show the actual key on creation)
    return NextResponse.json({
      apiKey: {
        ...apiKey,
        key // Only returned on creation
      },
      warning: 'Store this API key securely. It will not be shown again.'
    });

  } catch (error) {
    console.error('API key creation API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    
    // Check authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId');

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId parameter' }, { status: 400 });
    }

    const sanitizedSiteId = validateAndSanitizeInput(siteId);

    // Get all API keys for the site with permission check
    const { data: apiKeys, error } = await supabase
      .from('api_keys')
      .select(`
        id,
        name,
        last_used_at,
        requests_per_minute,
        requests_per_hour,
        requests_per_day,
        is_active,
        created_at,
        updated_at,
        sites!inner(
          id,
          domain,
          site_permissions!inner(
            permission,
            user_id
          )
        )
      `)
      .eq('site_id', sanitizedSiteId)
      .eq('sites.site_permissions.user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('API keys fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 });
    }

    // Don't return the actual keys or hashes
    const sanitizedApiKeys = apiKeys.map(({ key_hash, ...apiKey }) => ({
      ...apiKey,
      keyPreview: '***...' + (key_hash.slice(-8) || '')
    }));

    return NextResponse.json({ apiKeys: sanitizedApiKeys });

  } catch (error) {
    console.error('API keys fetch API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    
    // Check authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { apiKeyId, isActive, requestsPerMinute, requestsPerHour, requestsPerDay } = body;

    const sanitizedApiKeyId = validateAndSanitizeInput(apiKeyId);
    if (!sanitizedApiKeyId) {
      return NextResponse.json({ error: 'Missing API key ID' }, { status: 400 });
    }

    // Build update object
    const updates: any = { updated_at: new Date().toISOString() };
    if (typeof isActive === 'boolean') updates.is_active = isActive;
    if (typeof requestsPerMinute === 'number') updates.requests_per_minute = requestsPerMinute;
    if (typeof requestsPerHour === 'number') updates.requests_per_hour = requestsPerHour;
    if (typeof requestsPerDay === 'number') updates.requests_per_day = requestsPerDay;

    // Update API key with permission check
    const { data: updatedApiKey, error } = await supabase
      .from('api_keys')
      .update(updates)
      .eq('id', sanitizedApiKeyId)
      .eq('sites.site_permissions.user_id', session.user.id)
      .eq('sites.site_permissions.permission', 'admin')
      .select()
      .single();

    if (error) {
      console.error('API key update error:', error);
      return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 });
    }

    return NextResponse.json({ 
      apiKey: updatedApiKey,
      message: 'API key updated successfully' 
    });

  } catch (error) {
    console.error('API key update API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    
    // Check authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const apiKeyId = searchParams.get('apiKeyId');

    if (!apiKeyId) {
      return NextResponse.json({ error: 'Missing apiKeyId parameter' }, { status: 400 });
    }

    const sanitizedApiKeyId = validateAndSanitizeInput(apiKeyId);

    // Delete API key with permission check
    const { error } = await supabase
      .from('api_keys')
      .delete()
      .eq('id', sanitizedApiKeyId)
      .eq('sites.site_permissions.user_id', session.user.id)
      .eq('sites.site_permissions.permission', 'admin');

    if (error) {
      console.error('API key deletion error:', error);
      return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'API key deleted successfully' 
    });

  } catch (error) {
    console.error('API key deletion API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}