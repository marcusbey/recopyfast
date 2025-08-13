import { NextRequest, NextResponse } from 'next/server';
import { aiService } from '@/lib/ai/openai-service';

export async function POST(request: NextRequest) {
  try {
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