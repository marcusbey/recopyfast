/**
 * Site Languages API
 * GET: List all languages for a site
 * POST: Add a new language (no translation — see the POST handler)
 * PUT: Update language translations
 * DELETE: Remove a language
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { readStagingDeviceFingerprint } from "@/lib/auth/staging-device";
import { withPublicCors } from "@/lib/http/public-cors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { canonicalSiteId } from "@/lib/api/validation";

function extractStagingToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return request.nextUrl.searchParams.get("rcf_token");
}

function withCors(response: NextResponse, origin?: string | null) {
  return withPublicCors(response, origin, "GET,POST,PUT,DELETE,OPTIONS");
}

/**
 * Per site, fail closed — ADR 002 rule 4, the same shape as the per-site limiter
 * on api/content/[siteId]/route.ts:455-473.
 *
 * Every method here reaches `createServiceRoleClient`, which bypasses RLS, and
 * the credential that opens them is a staging token delivered in an invite link.
 * A link that leaks is a copied credential; this is what bounds what it can do,
 * and losing Redis must not remove it.
 *
 * Behind the access check, not in front of it: the bucket is the customer's own
 * site, so metering an anonymous caller into it would let anyone exhaust the
 * owner's budget by naming their site id.
 *
 * 50/min for reading and editing translations — a person working through a
 * language panel.
 *
 * Keyed on the canonical id: every handler passes `canonicalSiteId`'s value
 * (s77, s69 R1), so each spelling of one site spends this one bucket.
 */
function meterSite(request: NextRequest, siteId: string) {
  return enforceRateLimit(request, {
    limit: "USER_CONTENT_EDIT",
    endpoint: "edit-board/languages",
    identifier: siteId,
    identifierType: "api_key",
    onStoreFailure: "deny",
    message: "Language rate limit exceeded for this site.",
  });
}

/**
 * Adding a language is metered far tighter, and separately. It was sized for
 * `autoTranslate`, which ran one OpenAI call PER content element — a single
 * accepted request was an unbounded-ish bill, not one row. That branch is gone
 * (s40, see the POST handler); the bucket stays because it costs nothing and
 * adding a language is still a once-in-a-while human action.
 *
 * 10/min.
 */
function meterTranslation(request: NextRequest, siteId: string) {
  return enforceRateLimit(request, {
    limit: "API_UPLOAD",
    endpoint: "edit-board/languages-add",
    identifier: siteId,
    identifierType: "api_key",
    onStoreFailure: "deny",
    message: "Language creation rate limit exceeded for this site.",
  });
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
    const rawSiteId = request.nextUrl.searchParams.get("siteId");

    if (!token || !rawSiteId) {
      return withCors(
        NextResponse.json(
          { error: "Missing staging token or siteId" },
          { status: 401 },
        ),
        origin,
      );
    }

    // s77 (s69 R1): the canonical id, before the access check and the limiter.
    const canonical = canonicalSiteId(rawSiteId);
    if (!canonical.ok) {
      return withCors(
        NextResponse.json({ error: canonical.error }, { status: 400 }),
        origin,
      );
    }
    const siteId = canonical.value;

    // Validate staging access
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
      readStagingDeviceFingerprint(request),
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

    const limited = await meterSite(request, siteId);
    if (limited) return withCors(limited, origin);

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

    // `autoTranslate` is deliberately not read. Every cached copy of the
    // permanent-URL widget built before s40 still sends `autoTranslate: true`
    // (the checkbox was on by default), so the field stays tolerated rather than
    // rejected — and ignored. See the tombstone at the insert below.
    const {
      siteId: rawSiteId,
      languageCode,
      languageName,
      isDefault = false,
    } = await request.json();

    if (!rawSiteId || !languageCode) {
      return withCors(
        NextResponse.json(
          { error: "Missing required fields: siteId, languageCode" },
          { status: 400 },
        ),
        origin,
      );
    }

    // s77 (s69 R1): the canonical id, before the access check and the limiter.
    const canonical = canonicalSiteId(rawSiteId);
    if (!canonical.ok) {
      return withCors(
        NextResponse.json({ error: canonical.error }, { status: 400 }),
        origin,
      );
    }
    const siteId = canonical.value;

    // Validate staging access (admin permission required)
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
      readStagingDeviceFingerprint(request),
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

    const limited = await meterTranslation(request, siteId);
    if (limited) return withCors(limited, origin);

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

    // TOMBSTONE (s40): there used to be an `autoTranslate` branch here, driven
    // by the Edit Board's "Auto-translate with AI" checkbox, on by default. It
    // read every content element on the site and made ONE OpenAI call PER
    // ELEMENT — unmetered, charged to nobody, never checked against the owner's
    // plan — and wrote the results into `site_languages.translations`, a column
    // that nothing in the product reads (this route is the only code that
    // touches the table). Real money, spent on every "Add Language" click, for
    // output no page ever displayed.
    //
    // Removed rather than billed: billing it would mean charging customers for
    // translations they cannot see. Re-adding it needs both halves at once —
    // owner billing on the path `/api/ai/suggest` uses (editor authorised,
    // `resolveSiteOwnerId`, `consumeFeatureUsage` with the service client) AND
    // a reader that actually serves `site_languages.translations` to visitors.
    const { data: language, error } = await supabase
      .from("site_languages")
      .insert({
        site_id: siteId,
        language_code: languageCode,
        language_name: finalLanguageName,
        is_default: isDefault,
        translations: {},
        translation_coverage: 0,
        last_translated_at: null,
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

    const {
      siteId: rawSiteId,
      languageId,
      translations,
      isDefault,
    } = await request.json();

    if (!rawSiteId || !languageId) {
      return withCors(
        NextResponse.json(
          { error: "Missing required fields: siteId, languageId" },
          { status: 400 },
        ),
        origin,
      );
    }

    // s77 (s69 R1): the canonical id, before the access check and the limiter.
    const canonical = canonicalSiteId(rawSiteId);
    if (!canonical.ok) {
      return withCors(
        NextResponse.json({ error: canonical.error }, { status: 400 }),
        origin,
      );
    }
    const siteId = canonical.value;

    // Validate staging access (edit permission required)
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
      readStagingDeviceFingerprint(request),
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

    const limited = await meterSite(request, siteId);
    if (limited) return withCors(limited, origin);

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
    const rawSiteId = request.nextUrl.searchParams.get("siteId");
    const languageId = request.nextUrl.searchParams.get("languageId");

    if (!token || !rawSiteId || !languageId) {
      return withCors(
        NextResponse.json(
          { error: "Missing required parameters" },
          { status: 400 },
        ),
        origin,
      );
    }

    // s77 (s69 R1): the canonical id, before the access check and the limiter.
    const canonical = canonicalSiteId(rawSiteId);
    if (!canonical.ok) {
      return withCors(
        NextResponse.json({ error: canonical.error }, { status: 400 }),
        origin,
      );
    }
    const siteId = canonical.value;

    // Validate staging access (admin permission required)
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
      readStagingDeviceFingerprint(request),
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

    const limited = await meterSite(request, siteId);
    if (limited) return withCors(limited, origin);

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
  return withCors(new NextResponse(null, { status: 204 }), origin);
}
