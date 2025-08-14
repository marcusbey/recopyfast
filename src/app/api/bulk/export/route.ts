import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { BulkExportPayload } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body: BulkExportPayload = await req.json();
    const { site_id, format, filters } = body;

    if (!site_id || !format) {
      return NextResponse.json(
        { error: 'Missing required fields: site_id, format' },
        { status: 400 }
      );
    }

    // Verify user authentication and permissions
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check site permissions
    const { data: permission } = await supabase
      .from('site_permissions')
      .select('permission')
      .eq('site_id', site_id)
      .eq('user_id', user.id)
      .single();

    if (!permission || !['view', 'edit', 'admin'].includes(permission.permission)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Build query with filters
    let query = supabase
      .from('content_elements')
      .select('*')
      .eq('site_id', site_id);

    if (filters?.language) {
      query = query.eq('language', filters.language);
    }

    if (filters?.variant) {
      query = query.eq('variant', filters.variant);
    }

    if (filters?.element_ids && filters.element_ids.length > 0) {
      query = query.in('element_id', filters.element_ids);
    }

    if (filters?.updated_since) {
      query = query.gte('updated_at', filters.updated_since);
    }

    const { data: contentElements, error } = await query;

    if (error) {
      throw error;
    }

    if (!contentElements || contentElements.length === 0) {
      return NextResponse.json(
        { error: 'No content elements found' },
        { status: 404 }
      );
    }

    // Generate export data based on format
    let exportData: string;
    let contentType: string;
    let filename: string;

    switch (format) {
      case 'json':
        exportData = JSON.stringify(contentElements, null, 2);
        contentType = 'application/json';
        filename = `content-export-${site_id}-${Date.now()}.json`;
        break;

      case 'csv':
        exportData = generateCSV(contentElements);
        contentType = 'text/csv';
        filename = `content-export-${site_id}-${Date.now()}.csv`;
        break;

      case 'xml':
        exportData = generateXML(contentElements);
        contentType = 'application/xml';
        filename = `content-export-${site_id}-${Date.now()}.xml`;
        break;

      default:
        return NextResponse.json(
          { error: `Unsupported format: ${format}` },
          { status: 400 }
        );
    }

    // Create bulk operation record for tracking
    await supabase
      .from('bulk_operations')
      .insert({
        user_id: user.id,
        site_id,
        operation_type: 'export',
        status: 'completed',
        total_items: contentElements.length,
        processed_items: contentElements.length,
        failed_items: 0,
        configuration: { format, filters },
        result_data: {
          exported_items: contentElements.length,
          format,
          filename
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      });

    // Return file as download
    return new NextResponse(exportData, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': exportData.length.toString()
      }
    });

  } catch (error) {
    console.error('Bulk export error:', error);
    return NextResponse.json(
      { error: 'Failed to export content' },
      { status: 500 }
    );
  }
}

function generateCSV(contentElements: any[]): string {
  if (contentElements.length === 0) return '';

  // CSV headers
  const headers = [
    'id',
    'site_id',
    'element_id',
    'selector',
    'original_content',
    'current_content',
    'language',
    'variant',
    'metadata',
    'created_at',
    'updated_at'
  ];

  // CSV rows
  const rows = contentElements.map(element => [
    element.id,
    element.site_id,
    element.element_id,
    element.selector,
    `"${(element.original_content || '').replace(/"/g, '""')}"`,
    `"${(element.current_content || '').replace(/"/g, '""')}"`,
    element.language,
    element.variant,
    `"${JSON.stringify(element.metadata || {}).replace(/"/g, '""')}"`,
    element.created_at,
    element.updated_at
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

function generateXML(contentElements: any[]): string {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const rootStart = '<content_elements>\n';
  const rootEnd = '</content_elements>';

  const xmlElements = contentElements.map(element => {
    return `  <content_element>
    <id>${escapeXML(element.id)}</id>
    <site_id>${escapeXML(element.site_id)}</site_id>
    <element_id>${escapeXML(element.element_id)}</element_id>
    <selector>${escapeXML(element.selector)}</selector>
    <original_content><![CDATA[${element.original_content || ''}]]></original_content>
    <current_content><![CDATA[${element.current_content || ''}]]></current_content>
    <language>${escapeXML(element.language)}</language>
    <variant>${escapeXML(element.variant)}</variant>
    <metadata><![CDATA[${JSON.stringify(element.metadata || {})}]]></metadata>
    <created_at>${escapeXML(element.created_at)}</created_at>
    <updated_at>${escapeXML(element.updated_at)}</updated_at>
  </content_element>`;
  }).join('\n');

  return xmlHeader + rootStart + xmlElements + '\n' + rootEnd;
}

function escapeXML(str: string): string {
  if (typeof str !== 'string') return String(str);
  
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const userId = searchParams.get('userId');

    if (!siteId) {
      return NextResponse.json(
        { error: 'Missing siteId parameter' },
        { status: 400 }
      );
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get export operations for the site
    let query = supabase
      .from('bulk_operations')
      .select('*')
      .eq('operation_type', 'export')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: operations, error } = await query.limit(50);

    if (error) {
      throw error;
    }

    return NextResponse.json(operations || []);
  } catch (error) {
    console.error('Get export operations error:', error);
    return NextResponse.json(
      { error: 'Failed to get export operations' },
      { status: 500 }
    );
  }
}