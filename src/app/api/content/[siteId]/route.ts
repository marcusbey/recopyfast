import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/service';
import {
  authorizeSiteRequest,
  authorizeSiteOrigin,
  sanitizeIncomingContent,
} from '@/lib/security/site-auth';

interface ContentMapData {
  selector: string;
  content: string;
  type: string;
}

function extractToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  const token = request.nextUrl.searchParams.get('token');
  return token;
}

function withCors(response: NextResponse, allowedOrigin: string | null) {
  const defaultOrigin = process.env.NEXT_PUBLIC_APP_URL || '*';
  const originHeader = allowedOrigin || defaultOrigin;
  response.headers.set('Access-Control-Allow-Origin', originHeader);
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  response.headers.set('Vary', 'Origin');
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { siteId: string } }
) {
  try {
    const { siteId } = params;
    const supabase = createServiceRoleClient();
    const token = extractToken(request);
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');

    let allowedOrigin: string | null = null;

    try {
      ({ allowedOrigin } = await authorizeSiteRequest({
        siteId,
        token: token,
        origin,
        referer,
      }));
    } catch (authError) {
      console.error('Content GET authorization failed:', authError);
      return NextResponse.json(
        { error: authError instanceof Error ? authError.message : 'Unauthorized' },
        { status: authError instanceof Error && authError.message === 'Origin not allowed' ? 403 : 401 }
      );
    }
    
    // Get language and variant from query params
    const searchParams = request.nextUrl.searchParams;
    const language = searchParams.get('language') || 'en';
    const variant = searchParams.get('variant') || 'default';
    
    // Fetch content elements
    const { data: contentElements, error } = await supabase
      .from('content_elements')
      .select('*')
      .eq('site_id', siteId)
      .eq('language', language)
      .eq('variant', variant);
    
    if (error) {
      console.error('Error fetching content:', error);
      return NextResponse.json(
        { error: 'Failed to fetch content' },
        { status: 500 }
      );
    }
    
    return withCors(NextResponse.json(contentElements || []), allowedOrigin);
  } catch (error) {
    console.error('Error in content fetch:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { siteId: string } }
) {
  try {
    const { siteId } = params;
    const contentMap = await request.json();
    const supabase = createServiceRoleClient();
    const token = extractToken(request);
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');

    let allowedOrigin: string | null = null;

    try {
      ({ allowedOrigin } = await authorizeSiteRequest({
        siteId,
        token: token,
        origin,
        referer,
      }));
    } catch (authError) {
      console.error('Content POST authorization failed:', authError);
      return NextResponse.json(
        { error: authError instanceof Error ? authError.message : 'Unauthorized' },
        { status: authError instanceof Error && authError.message === 'Origin not allowed' ? 403 : 401 }
      );
    }
    
    // Verify site exists
    const { data: site } = await supabase
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .single();
    
    if (!site) {
      return withCors(
        NextResponse.json(
        { error: 'Site not found' },
        { status: 404 }
        ),
        allowedOrigin
      );
    }
    
    // Process content map
    const contentElements = Object.entries(contentMap).map(([elementId, data]: [string, ContentMapData]) => {
      const sanitizedContent = sanitizeIncomingContent(data.content);

      return {
        site_id: siteId,
        element_id: elementId,
        selector: data.selector,
        original_content: sanitizedContent,
        current_content: sanitizedContent,
        language: 'en',
        variant: 'default',
        metadata: { type: data.type },
      };
    });
    
    // Upsert content elements
    const { error } = await supabase
      .from('content_elements')
      .upsert(contentElements, {
        onConflict: 'site_id,element_id,language,variant'
      });
    
    if (error) {
      console.error('Error upserting content:', error);
      return withCors(
        NextResponse.json(
        { error: 'Failed to save content' },
        { status: 500 }
        ),
        allowedOrigin
      );
    }
    
    return withCors(NextResponse.json({ success: true }), allowedOrigin);
  } catch (error) {
    console.error('Error in content save:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { siteId: string } }
) {
  try {
    const { siteId } = params;
    const { elementId, content, language = 'en', variant = 'default' } = await request.json();
    const sanitizedContent = sanitizeIncomingContent(content);
    const supabase = createServiceRoleClient();
    const token = extractToken(request);
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');

    let allowedOrigin: string | null = null;

    try {
      ({ allowedOrigin } = await authorizeSiteRequest({
        siteId,
        token: token,
        origin,
        referer,
      }));
    } catch (authError) {
      console.error('Content PUT authorization failed:', authError);
      return NextResponse.json(
        { error: authError instanceof Error ? authError.message : 'Unauthorized' },
        { status: authError instanceof Error && authError.message === 'Origin not allowed' ? 403 : 401 }
      );
    }
    
    // Update content element
    const { error } = await supabase
      .from('content_elements')
      .update({ current_content: sanitizedContent })
      .eq('site_id', siteId)
      .eq('element_id', elementId)
      .eq('language', language)
      .eq('variant', variant);
    
    if (error) {
      console.error('Error updating content:', error);
      return withCors(
        NextResponse.json(
        { error: 'Failed to update content' },
        { status: 500 }
        ),
        allowedOrigin
      );
    }
    
    return withCors(NextResponse.json({ success: true }), allowedOrigin);
  } catch (error) {
    console.error('Error in content update:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(
  request: NextRequest,
  { params }: { params: { siteId: string } }
) {
  try {
    const { allowedOrigin } = await authorizeSiteOrigin(
      params.siteId,
      request.headers.get('origin'),
      request.headers.get('referer')
    );

    return withCors(NextResponse.json({}, { status: 204 }), allowedOrigin);
  } catch (error) {
    return NextResponse.json(
      { error: 'Origin not allowed' },
      { status: 403 }
    );
  }
}
