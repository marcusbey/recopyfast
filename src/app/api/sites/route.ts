import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { buildSiteToken } from '@/lib/security/site-auth';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const serviceClient = createServiceRoleClient();

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch sites with permissions for the user
    const { data: permissions, error: permissionsError } = await serviceClient
      .from('site_permissions')
      .select('site_id, permission')
      .eq('user_id', user.id);

    if (permissionsError) {
      console.error('Error fetching site permissions:', permissionsError);
      return NextResponse.json(
        { error: 'Failed to fetch site permissions' },
        { status: 500 }
      );
    }

    if (!permissions || permissions.length === 0) {
      return NextResponse.json({ sites: [] });
    }

    const siteIds = permissions.map((p) => p.site_id);

    // Fetch sites data
    const { data: sites, error: sitesError } = await serviceClient
      .from('sites')
      .select('id, domain, name, created_at, updated_at, api_key')
      .in('id', siteIds);

    if (sitesError) {
      console.error('Error fetching sites:', sitesError);
      return NextResponse.json({ error: 'Failed to fetch sites' }, { status: 500 });
    }

    // Fetch stats for each site
    const sitesWithStats = await Promise.all(
      sites.map(async (site) => {
        // Get content elements count
        const { count: elementsCount } = await serviceClient
          .from('content_elements')
          .select('*', { count: 'exact', head: true })
          .eq('site_id', site.id);

        // Get edits count from content_history
        const { count: editsCount } = await serviceClient
          .from('content_history')
          .select('*', { count: 'exact', head: true })
          .in(
            'content_element_id',
            serviceClient
              .from('content_elements')
              .select('id')
              .eq('site_id', site.id)
          );

        // Get last activity
        const { data: lastActivity } = await serviceClient
          .from('content_history')
          .select('created_at')
          .in(
            'content_element_id',
            serviceClient
              .from('content_elements')
              .select('id')
              .eq('site_id', site.id)
          )
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        // Generate site token
        const siteToken = buildSiteToken(site.id, site.api_key);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const embedScript = `<script src="${appUrl}/embed/recopyfast.js" data-site-id="${site.id}" data-site-token="${siteToken}"></script>`;

        return {
          id: site.id,
          domain: site.domain,
          name: site.name,
          created_at: site.created_at,
          updated_at: site.updated_at,
          status: elementsCount && elementsCount > 0 ? 'active' : 'verifying',
          stats: {
            content_elements_count: elementsCount || 0,
            edits_count: editsCount || 0,
            views: 0, // TODO: Implement views tracking
            last_activity: lastActivity?.created_at || null,
          },
          siteToken,
          embedScript,
        };
      })
    );

    return NextResponse.json({ sites: sitesWithStats });
  } catch (error) {
    console.error('Error in sites API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}