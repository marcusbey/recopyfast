import { NextRequest, NextResponse } from 'next/server';
import { aiService } from '@/lib/ai/openai-service';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { 
      siteId, 
      fromLanguage, 
      toLanguage, 
      elements,
      context 
    } = await request.json();
    
    if (!siteId || !fromLanguage || !toLanguage || !elements) {
      return NextResponse.json(
        { error: 'Missing required fields: siteId, fromLanguage, toLanguage, elements' },
        { status: 400 }
      );
    }

    // Verify site access (you can add authentication here)
    const supabase = await createClient();
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

    // Translate all elements
    const result = await aiService.batchTranslate(
      elements,
      fromLanguage,
      toLanguage,
      context
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    // Save translations to database as new language variant
    const translatedElements = result.data!.map(translation => ({
      site_id: siteId,
      element_id: translation.id,
      selector: '', // Will be populated from existing element
      original_content: translation.originalText,
      current_content: translation.translatedText,
      language: toLanguage,
      variant: 'default',
      metadata: {
        translatedFrom: fromLanguage,
        aiGenerated: true,
        tokensUsed: result.tokensUsed
      }
    }));

    // Insert or update translated content
    const { error: dbError } = await supabase
      .from('content_elements')
      .upsert(translatedElements, {
        onConflict: 'site_id,element_id,language,variant'
      });

    if (dbError) {
      console.error('Error saving translations:', dbError);
      // Still return success since translation worked
    }

    return NextResponse.json({
      success: true,
      translations: result.data,
      tokensUsed: result.tokensUsed,
      message: `Successfully translated ${result.data!.length} elements to ${toLanguage}`
    });

  } catch (error) {
    console.error('Translation API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}