import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(
  req: NextRequest,
  { params }: { params: { testId: string } }
) {
  try {
    const testId = params.testId;

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
      .select('site_id, name')
      .eq('id', testId)
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

    if (!permission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Get test results with variants
    const { data: results, error: resultsError } = await supabase
      .from('ab_test_results')
      .select(`
        *,
        variant:ab_test_variants(variant_name, traffic_percentage)
      `)
      .eq('test_id', testId)
      .order('recorded_at', { ascending: false });

    if (resultsError) {
      throw resultsError;
    }

    // Get variants
    const { data: variants, error: variantsError } = await supabase
      .from('ab_test_variants')
      .select('*')
      .eq('test_id', testId);

    if (variantsError) {
      throw variantsError;
    }

    // Calculate statistics
    const statistics = calculateTestStatistics(results || [], variants || []);

    return NextResponse.json({
      test: test,
      results: results || [],
      variants: variants || [],
      statistics
    });
  } catch (error) {
    console.error('Get A/B test results error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch test results' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { testId: string } }
) {
  try {
    const testId = params.testId;
    const body = await req.json();
    const { variant_id, event_type, value, metadata, user_id, session_id } = body;

    if (!variant_id || !event_type) {
      return NextResponse.json(
        { error: 'Missing required fields: variant_id, event_type' },
        { status: 400 }
      );
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get: () => '',
          set: () => {},
          remove: () => {},
        },
      }
    );

    // Verify variant belongs to test
    const { data: variant, error: variantError } = await supabase
      .from('ab_test_variants')
      .select('test_id')
      .eq('id', variant_id)
      .eq('test_id', testId)
      .single();

    if (variantError || !variant) {
      return NextResponse.json({ error: 'Invalid variant' }, { status: 400 });
    }

    // Record test result
    const { data: result, error } = await supabase
      .from('ab_test_results')
      .insert({
        test_id: testId,
        variant_id,
        user_id,
        session_id,
        event_type,
        value: value || 1,
        metadata: metadata || {},
        recorded_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Record A/B test result error:', error);
    return NextResponse.json(
      { error: 'Failed to record test result' },
      { status: 500 }
    );
  }
}

function calculateTestStatistics(results: any[], variants: any[]) {
  const variantStats = variants.map(variant => {
    const variantResults = results.filter(r => r.variant_id === variant.id);
    const views = variantResults.filter(r => r.event_type === 'view').length;
    const conversions = variantResults.filter(r => r.event_type === 'conversion').length;
    const conversionRate = views > 0 ? conversions / views : 0;

    return {
      variant_id: variant.id,
      variant_name: variant.variant_name,
      traffic_percentage: variant.traffic_percentage,
      views,
      conversions,
      conversion_rate: conversionRate,
      total_value: variantResults.reduce((sum, r) => sum + (r.value || 0), 0)
    };
  });

  // Calculate statistical significance (simplified)
  const controlStats = variantStats[0];
  const treatmentStats = variantStats.slice(1);

  const significanceResults = treatmentStats.map(treatment => {
    const significance = calculateSignificance(
      controlStats.conversions,
      controlStats.views,
      treatment.conversions,
      treatment.views
    );

    return {
      variant_id: treatment.variant_id,
      variant_name: treatment.variant_name,
      lift: controlStats.conversion_rate > 0 
        ? ((treatment.conversion_rate - controlStats.conversion_rate) / controlStats.conversion_rate) * 100
        : 0,
      significance: significance.significant,
      confidence: significance.confidence,
      p_value: significance.pValue
    };
  });

  return {
    variant_stats: variantStats,
    significance_results: significanceResults,
    total_participants: new Set(results.map(r => r.user_id || r.session_id)).size,
    test_duration_days: Math.ceil(
      (new Date().getTime() - new Date(Math.min(...results.map(r => new Date(r.recorded_at).getTime()))).getTime()) 
      / (1000 * 60 * 60 * 24)
    )
  };
}

function calculateSignificance(
  controlConversions: number,
  controlViews: number,
  treatmentConversions: number,
  treatmentViews: number
) {
  // Simplified statistical significance calculation
  // In production, use a proper statistical library
  
  const controlRate = controlViews > 0 ? controlConversions / controlViews : 0;
  const treatmentRate = treatmentViews > 0 ? treatmentConversions / treatmentViews : 0;
  
  if (controlViews < 30 || treatmentViews < 30) {
    return { significant: false, confidence: 0, pValue: 1 };
  }

  const pooledRate = (controlConversions + treatmentConversions) / (controlViews + treatmentViews);
  const standardError = Math.sqrt(
    pooledRate * (1 - pooledRate) * (1 / controlViews + 1 / treatmentViews)
  );
  
  const zScore = Math.abs(treatmentRate - controlRate) / standardError;
  
  // Approximate p-value calculation
  const pValue = 2 * (1 - normalCDF(Math.abs(zScore)));
  const significant = pValue < 0.05;
  const confidence = (1 - pValue) * 100;

  return { significant, confidence, pValue };
}

function normalCDF(x: number): number {
  // Approximation of the cumulative distribution function for standard normal distribution
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function erf(x: number): number {
  // Approximation of the error function
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}