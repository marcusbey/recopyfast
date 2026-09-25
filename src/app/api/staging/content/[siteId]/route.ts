/**
 * Staging Content API
 * GET: Fetch staging content (requires verified staging token)
 * PUT: Update staging content (requires edit permission)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  authorizeFirstPartyEditorAccess,
  requireEditorPermission,
  validateEditorTokenFromRequest,
} from "@/lib/auth/editor-access";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";
import { sanitizeIncomingContent } from "@/lib/security/site-auth";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { validateContentAttributePatch } from "@/lib/api/validation";
import { fetchPageScopedRows } from "@/lib/content/paged-elements";
import { normalizePagePath } from "@/lib/content/page-path";

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stagedMetadata(value: unknown) {
  const metadata = jsonObject(value);
  const stagingAttributes = jsonObject(metadata.staging_attributes);
  const publishedMetadata = { ...metadata };
  delete publishedMetadata.staging_attributes;

  return {
    metadata: { ...publishedMetadata, ...stagingAttributes },
    hasAttributeChanges: Object.entries(stagingAttributes).some(
      ([key, value]) => publishedMetadata[key] !== value,
    ),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;

    // Same first-party path as PUT below. Without it the owner could save a
    // draft and then be refused when reading it back, which is a worse state
    // than not being able to edit at all.
    let access = await authorizeFirstPartyEditorAccess(siteId, "view");

    if (!access) {
      const validation = await validateEditorTokenFromRequest({
        request,
        siteId,
      });
      if (!validation.valid || !validation.access) {
        return withPublicCors(
          NextResponse.json(
            { error: validation.error || "Invalid editor token" },
            { status: validation.status || 401 },
          ),
          request,
        );
      }

      if (!requireEditorPermission(validation.access, "view")) {
        return withPublicCors(
          NextResponse.json(
            { error: "Requires 'view' permission" },
            { status: 403 },
          ),
          request,
        );
      }

      access = validation.access;
    }

    const supabase = createServiceRoleClient();

    // Get language and variant from query params
    const searchParams = request.nextUrl.searchParams;
    const language = searchParams.get("language") || "en";
    const variant = searchParams.get("variant") || "default";
    const requestedPagePath = searchParams.get("page_path");
    const normalizedPagePath =
      requestedPagePath === null ? null : normalizePagePath(requestedPagePath);
    if (normalizedPagePath && !normalizedPagePath.ok) {
      return withPublicCors(
        NextResponse.json({ error: normalizedPagePath.error }, { status: 400 }),
        request,
      );
    }
    const pagePath = normalizedPagePath?.value ?? null;

    const { data: contentElements, error } = await fetchPageScopedRows(
      (scope) => {
        let query = supabase
          .from("content_elements")
          .select(
            "id, site_id, element_id, selector, staging_content, published_content, original_content, language, variant, page_path, metadata, staging_updated_at, staging_updated_by, published_at",
          )
          .eq("site_id", siteId)
          .eq("language", language)
          .eq("variant", variant);

        if (scope.kind === "page") {
          query = query.eq("page_path", scope.pagePath);
        } else if (scope.kind === "shared") {
          query = query.is("page_path", null);
        }
        return query;
      },
      pagePath,
    );

    if (error) {
      console.error("Error fetching staging content:", error);
      return withPublicCors(
        NextResponse.json(
          { error: "Failed to fetch staging content" },
          { status: 500 },
        ),
        request,
      );
    }

    // Transform content: use staging_content if available, otherwise published_content
    const transformedContent = (contentElements || []).map((element) => {
      const projection = stagedMetadata(element.metadata);

      return {
        ...element,
        metadata: projection.metadata,
        // For display, use staging_content if it exists, otherwise published_content
        current_content: element.staging_content ?? element.published_content,
        // Attribute-only edits must remain visible and publishable even when the
        // editor did not change the element's text in the same save.
        has_staging_changes:
          projection.hasAttributeChanges ||
          (element.staging_content !== null &&
            element.staging_content !== element.published_content),
      };
    });

    return withPublicCors(
      NextResponse.json({
        content: transformedContent,
        permissions: access.permissions,
        email: access.email,
      }),
      request,
    );
  } catch (error) {
    console.error("Error in staging content fetch:", error);
    return withPublicCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;
    const requestBody = (await request.json()) as Record<string, unknown>;
    const elementId =
      typeof requestBody.elementId === "string" ? requestBody.elementId : "";
    const content = requestBody.content;
    const language =
      typeof requestBody.language === "string" ? requestBody.language : "en";
    const variant =
      typeof requestBody.variant === "string" ? requestBody.variant : "default";
    const attributePatch = validateContentAttributePatch(requestBody);

    if (!attributePatch.ok) {
      return withPublicCors(
        NextResponse.json({ error: attributePatch.error }, { status: 400 }),
        request,
      );
    }

    // The site's own owner is signed in and holds a `site_permissions` row; they
    // carry no editor token and never can, so validating tokens alone refused
    // the one caller guaranteed to hold every right. Tried first, falls through
    // to the token path untouched — see authorizeFirstPartyEditorAccess.
    //
    // Asked at "view" and graded afterwards, matching the GET handler above and
    // /api/staging/publish. The helper returns null both for "no first-party
    // access at all" and for "has access, but not at this level", so asking for
    // "edit" up front made a view-only collaborator indistinguishable from an
    // anonymous caller: they fell through to the token path and were told their
    // editor token was invalid, which is unactionable advice for someone who is
    // plainly signed in and never had a token.
    const firstPartyAccess = await authorizeFirstPartyEditorAccess(
      siteId,
      "view",
    );

    if (
      firstPartyAccess &&
      !requireEditorPermission(firstPartyAccess, "edit")
    ) {
      return withPublicCors(
        NextResponse.json(
          { error: "Requires 'edit' permission" },
          { status: 403 },
        ),
        request,
      );
    }

    let access = firstPartyAccess;

    if (!access) {
      const validation = await validateEditorTokenFromRequest({
        request,
        siteId,
        body: requestBody,
      });
      if (!validation.valid || !validation.access) {
        return withPublicCors(
          NextResponse.json(
            { error: validation.error || "Invalid editor token" },
            { status: validation.status || 403 },
          ),
          request,
        );
      }

      if (!requireEditorPermission(validation.access, "edit")) {
        return withPublicCors(
          NextResponse.json(
            { error: "Requires 'edit' permission" },
            { status: 403 },
          ),
          request,
        );
      }

      access = validation.access;
    }

    if (!elementId || content === undefined) {
      return withPublicCors(
        NextResponse.json(
          { error: "Missing elementId or content" },
          { status: 400 },
        ),
        request,
      );
    }

    // Per site, fail closed, behind the permission grade — the pattern of the
    // per-site limiter on api/content/[siteId]/route.ts:455-473. (ADR 002 rule 4)
    //
    // This is the service-role UPDATE of staged copy, and the credential that
    // opens it is an invite link handed to a collaborator: a link that leaks is
    // a copied credential, and this limiter is what bounds what it can rewrite.
    //
    // Behind the grade, not in front: the bucket is the customer's site, so
    // metering an anonymous caller into it would let anyone exhaust the owner's
    // own editing budget by naming their site id.
    //
    // 50/min because a human is typing. The editor saves per element on blur,
    // not per keystroke (recopyfast.src.js persists on commit), so a real
    // session is nowhere near it and a refusal is retried by the next save.
    const limited = await enforceRateLimit(request, {
      limit: "USER_CONTENT_EDIT",
      endpoint: "staging/content-update",
      identifier: siteId,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "Staging edit rate limit exceeded for this site.",
    });
    if (limited) return withPublicCors(limited, request);

    const sanitizedContent = sanitizeIncomingContent(String(content));
    const supabase = createServiceRoleClient();

    // The draft and its audit entry are one database operation. This used to
    // update content_elements first and insert staging_history second; a failed
    // insert therefore returned 500 after the draft had already committed.
    const { data: savedRows, error: saveError } = await supabase.rpc(
      "save_staging_content_atomic",
      {
        p_site_id: siteId,
        p_element_id: elementId,
        p_language: language,
        p_variant: variant,
        p_staging_content: sanitizedContent,
        p_attribute_patch: attributePatch.value,
        p_staging_access_id: access.stagingAccessId || null,
        p_user_email: access.email || access.userId || access.kind,
      },
    );

    if (saveError) {
      console.error("Error saving staging content atomically:", saveError);
      return withPublicCors(
        NextResponse.json(
          { error: "Failed to update staging content" },
          { status: 500 },
        ),
        request,
      );
    }

    const saved = Array.isArray(savedRows) ? savedRows[0] : null;
    if (!saved) {
      return withPublicCors(
        NextResponse.json(
          { error: "Content element not found" },
          { status: 404 },
        ),
        request,
      );
    }

    return withPublicCors(
      NextResponse.json({
        success: true,
        elementId,
        updatedAt:
          typeof saved.updated_at === "string"
            ? saved.updated_at
            : new Date().toISOString(),
      }),
      request,
    );
  } catch (error) {
    console.error("Error in staging content update:", error);
    return withPublicCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "GET,PUT,OPTIONS");
}
