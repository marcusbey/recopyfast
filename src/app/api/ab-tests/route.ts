import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { ABTest, ABTestVariant } from '@/types';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');

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

    // Check site permissions
    const { data: permission } = await supabase
      .from('site_permissions')
      .select('permission')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .single();

    if (!permission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Get A/B tests with variants
    const { data: tests, error } = await supabase
      .from('ab_tests')
      .select(`
        *,
        variants:ab_test_variants(*)
      `)
      .eq('site_id', siteId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json(tests || []);
  } catch (error) {
    console.error('Get A/B tests error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch A/B tests' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { 
      site_id, 
      name, 
      description, 
      traffic_split, 
      success_metric,
      variants,
      start_date,
      end_date 
    } = body;

    if (!site_id || !name || !success_metric || !variants || variants.length < 2) {
      return NextResponse.json(
        { error: 'Missing required fields: site_id, name, success_metric, variants (min 2)' },
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

    // Check site permissions
    const { data: permission } = await supabase
      .from('site_permissions')
      .select('permission')
      .eq('site_id', site_id)
      .eq('user_id', user.id)
      .single();

    if (!permission || !['edit', 'admin'].includes(permission.permission)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Validate traffic percentages
    const totalTraffic = variants.reduce((sum: number, v: any) => sum + (v.traffic_percentage || 0), 0);
    if (totalTraffic !== 100) {
      return NextResponse.json(
        { error: 'Traffic percentages must sum to 100%' },
        { status: 400 }
      );
    }

    // Create A/B test
    const { data: test, error: testError } = await supabase
      .from('ab_tests')
      .insert({
        site_id,
        name,
        description,
        traffic_split: traffic_split || 0.5,
        success_metric,
        start_date,
        end_date,
        created_by: user.id,
        status: 'draft'
      })
      .select()
      .single();

    if (testError) {
      throw testError;
    }

    // Create variants
    const variantInserts = variants.map((variant: any) => ({
      test_id: test.id,
      content_element_id: variant.content_element_id,
      variant_name: variant.variant_name,
      content: variant.content,
      traffic_percentage: variant.traffic_percentage
    }));

    const { error: variantsError } = await supabase
      .from('ab_test_variants')
      .insert(variantInserts);

    if (variantsError) {
      // Cleanup test if variants failed
      await supabase.from('ab_tests').delete().eq('id', test.id);
      throw variantsError;
    }

    return NextResponse.json(test);
  } catch (error) {
    console.error('Create A/B test error:', error);
    return NextResponse.json(
      { error: 'Failed to create A/B test' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { test_id, status, ...updates } = body;

    if (!test_id) {
      return NextResponse.json(
        { error: 'Missing test_id' },
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

    // Get test and verify permissions
    const { data: test, error: testError } = await supabase
      .from('ab_tests')
      .select('site_id, created_by')
      .eq('id', test_id)
      .single();

    if (testError || !test) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    }

    // Check permissions
    const { data: permission } = await supabase
      .from('site_permissions')
      .select('permission')
      .eq('site_id', test.site_id)
      .eq('user_id', user.id)
      .single();

    if (!permission || !['edit', 'admin'].includes(permission.permission)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Update test
    const { data: updatedTest, error: updateError } = await supabase
      .from('ab_tests')
      .update({
        ...updates,
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', test_id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json(updatedTest);
  } catch (error) {
    console.error('Update A/B test error:', error);
    return NextResponse.json(
      { error: 'Failed to update A/B test' },
      { status: 500 }
    );
  }
}