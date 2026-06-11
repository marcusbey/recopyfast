import { NextRequest, NextResponse } from "next/server";
import { aiService } from "@/lib/ai/openai-service";
import { createClient } from "@/lib/supabase/server";
import { consumeFeatureUsage } from "@/lib/feature-gating/permissions";
import { sanitizeHTML } from "@/lib/security/content-sanitizer";

export async function POST(request: NextRequest) {
  try {
    const { siteId, fromLanguage, toLanguage, elements, context } =
      await request.json();

    if (!siteId || !fromLanguage || !toLanguage || !elements) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: siteId, fromLanguage, toLanguage, elements",
        },
        { status: 400 },
      );
    }

    // Check authentication and verify site access
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: site } = await supabase
      .from("sites")
      .select("id")
      .eq("id", siteId)
      .single();

    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // Authorization: the authenticated user must have a permission on this site.
    // Without this check any logged-in user could trigger paid translation jobs
    // and consume ticket quota billed to another tenant's site.
    const { data: permission } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", siteId)
      .eq("user_id", user.id)
      .single();

    if (!permission) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check feature access and consume usage
    const usageResult = await consumeFeatureUsage(user.id, "translation", {
      siteId,
      fromLanguage,
      toLanguage,
      elementCount: elements.length,
    });

    if (!usageResult.success) {
      return NextResponse.json(
        {
          error: usageResult.error,
          requiresUpgrade:
            usageResult.error?.includes("plan") ||
            usageResult.error?.includes("tickets"),
        },
        { status: 403 },
      );
    }

    // Translate all elements
    const result = await aiService.batchTranslate(
      elements,
      fromLanguage,
      toLanguage,
      context,
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Save translations to database as new language variant.
    // Sanitize AI-generated content before writing (XSS prevention — AI output
    // can contain injected markup if the source content was adversarially crafted).
    const translatedElements = result.data!.map((translation) => ({
      site_id: siteId,
      element_id: translation.id,
      selector: "", // Will be populated from existing element
      original_content: sanitizeHTML(translation.originalText, "RICH_TEXT"),
      current_content: sanitizeHTML(translation.translatedText, "RICH_TEXT"),
      language: toLanguage,
      variant: "default",
      metadata: {
        translatedFrom: fromLanguage,
        aiGenerated: true,
        tokensUsed: result.tokensUsed,
      },
    }));

    // Insert or update translated content
    const { error: dbError } = await supabase
      .from("content_elements")
      .upsert(translatedElements, {
        onConflict: "site_id,element_id,language,variant",
      });

    if (dbError) {
      console.error("Error saving translations:", dbError);
      // Still return success since translation worked
    }

    return NextResponse.json({
      success: true,
      translations: result.data,
      tokensUsed: result.tokensUsed,
      message: `Successfully translated ${result.data!.length} elements to ${toLanguage}`,
    });
  } catch (error) {
    console.error("Translation API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
