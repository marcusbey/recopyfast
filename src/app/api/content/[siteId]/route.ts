import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface ContentMapData {
  selector: string;
  content: string;
  type: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { siteId: string } }
) {
  try {
    const { siteId } = params;
    const supabase = await createClient();
    
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
    
    return NextResponse.json(contentElements || []);
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
    const supabase = await createClient();
    
    // Verify site exists
    const { data: site } = await supabase
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .single();
    
    if (!site) {
      return NextResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }
    
    // Process content map
    const contentElements = Object.entries(contentMap).map(([elementId, data]: [string, ContentMapData]) => ({
      site_id: siteId,
      element_id: elementId,
      selector: data.selector,
      original_content: data.content,
      current_content: data.content,
      language: 'en',
      variant: 'default',
      metadata: { type: data.type }
    }));
    
    // Upsert content elements
    const { error } = await supabase
      .from('content_elements')
      .upsert(contentElements, {
        onConflict: 'site_id,element_id,language,variant'
      });
    
    if (error) {
      console.error('Error upserting content:', error);
      return NextResponse.json(
        { error: 'Failed to save content' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true });
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
    const supabase = await createClient();
    
    // Update content element
    const { error } = await supabase
      .from('content_elements')
      .update({ current_content: content })
      .eq('site_id', siteId)
      .eq('element_id', elementId)
      .eq('language', language)
      .eq('variant', variant);
    
    if (error) {
      console.error('Error updating content:', error);
      return NextResponse.json(
        { error: 'Failed to update content' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in content update:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}