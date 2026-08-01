import { NextRequest, NextResponse } from "next/server";
import { aiService } from "@/lib/ai/openai-service";
import { createClient } from "@/lib/supabase/server";
import { consumeFeatureUsage } from "@/lib/feature-gating/permissions";
import { sanitizeHTML } from "@/lib/security/content-sanitizer";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import {
  optionalString,
  readJsonObject,
  requireString,
  requireUuid,
} from "@/lib/api/validation";

/** BCP-47-ish language tag, e.g. "en", "pt-BR". */
const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i;
const MAX_LANGUAGE_TAG_LENGTH = 20;
const MAX_CONTEXT_LENGTH = 1000;

/**
 * Batch ceilings. One request fans out to `elements.length` model calls, so
 * these are the hard cap on what a single authorized caller can spend per hit.
 */
const MAX_ELEMENTS_PER_REQUEST = 100;
const MAX_ELEMENT_TEXT_LENGTH = 5000;

interface TranslationElement {
  id: string;
  text: string;
}

function parseElements(
  raw: unknown,
): { ok: true; value: TranslationElement[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Field "elements" must be a non-empty array' };
  }
  if (raw.length > MAX_ELEMENTS_PER_REQUEST) {
    return {
      ok: false,
      error: `Field "elements" must contain at most ${MAX_ELEMENTS_PER_REQUEST} items`,
    };
  }

  const parsed: TranslationElement[] = [];
  for (const [index, entry] of raw.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `elements[${index}] must be an object` };
    }

    const { id, text } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim()) {
      return { ok: false, error: `elements[${index}].id must be a string` };
    }
    if (typeof text !== "string" || !text.trim()) {
      return { ok: false, error: `elements[${index}].text must be a string` };
    }
    if (text.length > MAX_ELEMENT_TEXT_LENGTH) {
      return {
        ok: false,
        error: `elements[${index}].text exceeds ${MAX_ELEMENT_TEXT_LENGTH} characters`,
      };
    }

    parsed.push({ id: id.trim(), text });
  }

  return { ok: true, value: parsed };
}

export async function POST(request: NextRequest) {
  try {
    // Pre-auth IP limit: throttle the unauthenticated path before it can be
    // used to probe for valid sessions against a paid endpoint.
    const ipLimited = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "ai/translate:ip",
      identifier: getClientIp(request),
      onStoreFailure: "deny",
    });
    if (ipLimited) return ipLimited;

    const body = await readJsonObject(request);
    if (!body.ok) {
      return NextResponse.json({ error: body.error }, { status: 400 });
    }

    const siteIdField = requireUuid(body.value, "siteId");
    if (!siteIdField.ok) {
      return NextResponse.json({ error: siteIdField.error }, { status: 400 });
    }
    const siteId = siteIdField.value;

    const fromLanguageField = requireString(body.value, "fromLanguage", {
      maxLength: MAX_LANGUAGE_TAG_LENGTH,
    });
    if (!fromLanguageField.ok) {
      return NextResponse.json(
        { error: fromLanguageField.error },
        { status: 400 },
      );
    }

    const toLanguageField = requireString(body.value, "toLanguage", {
      maxLength: MAX_LANGUAGE_TAG_LENGTH,
    });
    if (!toLanguageField.ok) {
      return NextResponse.json(
        { error: toLanguageField.error },
        { status: 400 },
      );
    }

    const fromLanguage = fromLanguageField.value;
    const toLanguage = toLanguageField.value;

    if (
      !LANGUAGE_TAG_PATTERN.test(fromLanguage) ||
      !LANGUAGE_TAG_PATTERN.test(toLanguage)
    ) {
      return NextResponse.json(
        { error: "Language tags must look like 'en' or 'pt-BR'" },
        { status: 400 },
      );
    }

    const elementsField = parseElements(body.value.elements);
    if (!elementsField.ok) {
      return NextResponse.json({ error: elementsField.error }, { status: 400 });
    }
    const elements = elementsField.value;

    const contextField = optionalString(body.value, "context", {
      maxLength: MAX_CONTEXT_LENGTH,
    });
    if (!contextField.ok) {
      return NextResponse.json({ error: contextField.error }, { status: 400 });
    }
    const context = contextField.value;

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

    // Per-site limit on the paid path. Keyed on the site rather than the user
    // because the spend is billed to the site and a team can hold many users.
    // Fails CLOSED — an unmetered translation endpoint is an unmetered OpenAI bill.
    const siteLimited = await enforceRateLimit(request, {
      limit: "API_UPLOAD",
      endpoint: "ai/translate",
      identifier: siteId,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "Too many translation requests for this site. Please slow down.",
    });
    if (siteLimited) return siteLimited;

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
