/**
 * Site Languages API
 * GET: List all languages for a site
 * POST: Add a new language (with optional auto-translation)
 * PUT: Update language translations
 * DELETE: Remove a language
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { aiService } from "@/lib/ai/openai-service";

function extractStagingToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return request.nextUrl.searchParams.get("rcf_token");
}

function withCors(response: NextResponse, allowedOrigin: string | null) {
  const defaultOrigin = process.env.NEXT_PUBLIC_APP_URL || "*";
  const originHeader = allowedOrigin || defaultOrigin;
  response.headers.set("Access-Control-Allow-Origin", originHeader);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type",
  );
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,OPTIONS",
  );
  response.headers.set("Vary", "Origin");
  return response;
}

// Common language codes and names
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  pl: "Polish",
  tr: "Turkish",
  vi: "Vietnamese",
  th: "Thai",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
};

// GET: List all languages for a site
export async function GET(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);
    const siteId = request.nextUrl.searchParams.get("siteId");

    if (!token || !siteId) {
      return withCors(
        NextResponse.json(
          { error: "Missing staging token or siteId" },
          { status: 401 },
        ),
        origin,
      );
    }

    // Validate staging access
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
    );
    if (!validation.valid || !validation.verified) {
      return withCors(
        NextResponse.json(
          { error: validation.error || "Access denied" },
          { status: 401 },
        ),
        origin,
      );
    }

    const supabase = createServiceRoleClient();

    const { data: languages, error } = await supabase
      .from("site_languages")
      .select(
        "id, language_code, language_name, is_default, translation_coverage, last_translated_at, created_at",
      )
      .eq("site_id", siteId)
      .order("is_default", { ascending: false })
      .order("language_name");

    if (error) {
      console.error("Error fetching languages:", error);
      return withCors(
        NextResponse.json(
          { error: "Failed to fetch languages" },
          { status: 500 },
        ),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        languages: languages || [],
        availableLanguages: Object.entries(LANGUAGE_NAMES).map(
          ([code, name]) => ({
            code,
            name,
          }),
        ),
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in languages list:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST: Add a new language
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);

    if (!token) {
      return withCors(
        NextResponse.json({ error: "Missing staging token" }, { status: 401 }),
        origin,
      );
    }

    const {
      siteId,
      languageCode,
      languageName,
      isDefault = false,
      autoTranslate = false,
    } = await request.json();

    if (!siteId || !languageCode) {
      return withCors(
        NextResponse.json(
          { error: "Missing required fields: siteId, languageCode" },
          { status: 400 },
        ),
        origin,
      );
    }

    // Validate staging access (admin permission required)
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
    );
    if (!validation.valid || !validation.verified) {
      return withCors(
        NextResponse.json(
          { error: validation.error || "Access denied" },
          { status: 401 },
        ),
        origin,
      );
    }

    if (!validation.permissions.includes("admin")) {
      return withCors(
        NextResponse.json(
          { error: "Admin permission required" },
          { status: 403 },
        ),
        origin,
      );
    }

    const supabase = createServiceRoleClient();

    // Determine language name
    const finalLanguageName =
      languageName ||
      LANGUAGE_NAMES[languageCode] ||
      languageCode.toUpperCase();

    // If setting as default, unset other defaults first
    if (isDefault) {
      await supabase
        .from("site_languages")
        .update({ is_default: false })
        .eq("site_id", siteId);
    }

    // Check if language already exists
    const { data: existing } = await supabase
      .from("site_languages")
      .select("id")
      .eq("site_id", siteId)
      .eq("language_code", languageCode)
      .single();

    if (existing) {
      return withCors(
        NextResponse.json(
          { error: "Language already exists for this site" },
          { status: 409 },
        ),
        origin,
      );
    }

    // Create translations object if auto-translate is enabled
    const translations: Record<string, string> = {};
    let translationCoverage = 0;

    if (autoTranslate) {
      // Get all content elements
      const { data: elements } = await supabase
        .from("content_elements")
        .select("element_id, staging_content, published_content")
        .eq("site_id", siteId);

      if (elements && elements.length > 0) {
        let translatedCount = 0;

        for (const element of elements) {
          const content = element.staging_content || element.published_content;
          if (!content) continue;

          try {
            // Use AI to translate
            const result = await aiService.translateText({
              text: content,
              fromLanguage: "English",
              toLanguage: finalLanguageName,
            });

            if (result.success && result.data) {
              translations[element.element_id] = result.data;
              translatedCount++;
            }
          } catch (translateError) {
            console.error(
              `Error translating element ${element.element_id}:`,
              translateError,
            );
          }
        }

        translationCoverage =
          elements.length > 0 ? (translatedCount / elements.length) * 100 : 0;
      }
    }

    // Create the language
    const { data: language, error } = await supabase
      .from("site_languages")
      .insert({
        site_id: siteId,
        language_code: languageCode,
        language_name: finalLanguageName,
        is_default: isDefault,
        translations: autoTranslate ? translations : {},
        translation_coverage: translationCoverage,
        last_translated_at: autoTranslate ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating language:", error);
      return withCors(
        NextResponse.json(
          { error: "Failed to create language" },
          { status: 500 },
        ),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        success: true,
        language,
        autoTranslated: autoTranslate,
        translatedCount: Object.keys(translations).length,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in language create:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT: Update language translations
export async function PUT(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);

    if (!token) {
      return withCors(
        NextResponse.json({ error: "Missing staging token" }, { status: 401 }),
        origin,
      );
    }

    const { siteId, languageId, translations, isDefault } =
      await request.json();

    if (!siteId || !languageId) {
      return withCors(
        NextResponse.json(
          { error: "Missing required fields: siteId, languageId" },
          { status: 400 },
        ),
        origin,
      );
    }

    // Validate staging access (edit permission required)
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
    );
    if (!validation.valid || !validation.verified) {
      return withCors(
        NextResponse.json(
          { error: validation.error || "Access denied" },
          { status: 401 },
        ),
        origin,
      );
    }

    const hasEditPermission =
      validation.permissions.includes("edit") ||
      validation.permissions.includes("publish") ||
      validation.permissions.includes("admin");

    if (!hasEditPermission) {
      return withCors(
        NextResponse.json(
          { error: "Edit permission required" },
          { status: 403 },
        ),
        origin,
      );
    }

    const supabase = createServiceRoleClient();

    // If setting as default, unset other defaults first
    if (isDefault) {
      await supabase
        .from("site_languages")
        .update({ is_default: false })
        .eq("site_id", siteId);
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (translations !== undefined) {
      updateData.translations = translations;
      updateData.last_translated_at = new Date().toISOString();

      // Calculate coverage
      const { data: elements } = await supabase
        .from("content_elements")
        .select("element_id", { count: "exact" })
        .eq("site_id", siteId);

      const totalElements = elements?.length || 0;
      const translatedElements = Object.keys(translations).length;
      updateData.translation_coverage =
        totalElements > 0 ? (translatedElements / totalElements) * 100 : 0;
    }

    if (isDefault !== undefined) {
      updateData.is_default = isDefault;
    }

    const { data: language, error } = await supabase
      .from("site_languages")
      .update(updateData)
      .eq("id", languageId)
      .eq("site_id", siteId)
      .select()
      .single();

    if (error) {
      console.error("Error updating language:", error);
      return withCors(
        NextResponse.json(
          { error: "Failed to update language" },
          { status: 500 },
        ),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        success: true,
        language,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in language update:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE: Remove a language
export async function DELETE(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);
    const siteId = request.nextUrl.searchParams.get("siteId");
    const languageId = request.nextUrl.searchParams.get("languageId");

    if (!token || !siteId || !languageId) {
      return withCors(
        NextResponse.json(
          { error: "Missing required parameters" },
          { status: 400 },
        ),
        origin,
      );
    }

    // Validate staging access (admin permission required)
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
    );
    if (!validation.valid || !validation.verified) {
      return withCors(
        NextResponse.json(
          { error: validation.error || "Access denied" },
          { status: 401 },
        ),
        origin,
      );
    }

    if (!validation.permissions.includes("admin")) {
      return withCors(
        NextResponse.json(
          { error: "Admin permission required" },
          { status: 403 },
        ),
        origin,
      );
    }

    const supabase = createServiceRoleClient();

    // Check if it's the default language
    const { data: language } = await supabase
      .from("site_languages")
      .select("is_default")
      .eq("id", languageId)
      .single();

    if (language?.is_default) {
      return withCors(
        NextResponse.json(
          { error: "Cannot delete the default language" },
          { status: 400 },
        ),
        origin,
      );
    }

    const { error } = await supabase
      .from("site_languages")
      .delete()
      .eq("id", languageId)
      .eq("site_id", siteId);

    if (error) {
      console.error("Error deleting language:", error);
      return withCors(
        NextResponse.json(
          { error: "Failed to delete language" },
          { status: 500 },
        ),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        success: true,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in language delete:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return withCors(NextResponse.json({}, { status: 204 }), origin);
}
