import { NextRequest, NextResponse } from 'next/server';
import { aiService } from '@/lib/ai/openai-service';
import { createClient } from '@/lib/supabase/server';
import { consumeFeatureUsage } from '@/lib/feature-gating/permissions';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { 
      text,
      context,
      tone,
      goal
    } = await request.json();
    
    if (!text || !context) {
      return NextResponse.json(
        { error: 'Missing required fields: text, context' },
        { status: 400 }
      );
    }

    // Check feature access and consume usage
    const usageResult = await consumeFeatureUsage(user.id, 'ai_suggestion', {
      originalText: text.substring(0, 100), // Store sample for analytics
      context,
      tone,
      goal
    });

    if (!usageResult.success) {
      return NextResponse.json(
        { 
          error: usageResult.error,
          requiresUpgrade: usageResult.error?.includes('plan') || usageResult.error?.includes('tickets')
        },
        { status: 403 }
      );
    }

    // Generate content suggestions
    const result = await aiService.generateContentSuggestion({
      originalText: text,
      context,
      tone: tone || 'professional',
      goal: goal || 'improve'
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      suggestions: result.data,
      tokensUsed: result.tokensUsed,
      originalText: text
    });

  } catch (error) {
    console.error('Content suggestion API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}