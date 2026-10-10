/**
 * Staging Publish API
 * POST: Publish staging content to live
 * GET: Preview pending staging changes
 */

import { NextRequest, NextResponse, after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  authorizeFirstPartyEditorAccess,
  requireEditorPermission,
  validateEditorTokenFromRequest,
} from "@/lib/auth/editor-access";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";
import { webhookManager, WEBHOOK_EVENTS } from "@/lib/webhooks/manager";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { canonicalSiteId } from "@/lib/api/validation";
import { fetchPageScopedRows } from "@/lib/content/paged-elements";
import { normalizePagePath } from "@/lib/content/page-path";
import {
  checkOwnerCanEdit,
  ownerCanEditRefusal,
} from "@/lib/billing/owner-can-edit";

type PublishRpcRow = {
  element_id: string;
  content: string | null;
  attributes: Record<string, string>;
};

function stagedMetadata(value: unknown) {
  const metadata =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const stagingAttributes =
    typeof metadata.staging_attributes === "object" &&
    metadata.staging_attributes !== null &&
    !Array.isArray(metadata.staging_attributes)
      ? (metadata.staging_attributes as Record<string, unknown>)
      : {};
  const publishedMetadata = { ...metadata };
  delete publishedMetadata.staging_attributes;

  return {
    metadata: { ...publishedMetadata, ...stagingAttributes },
    hasAttributeChanges: Object.entries(stagingAttributes).some(
      ([key, value]) => publishedMetadata[key] !== value,
    ),
  };
}

/**
 * s77 (s69 L7) — per IP, before anything is decided about the caller.
 *
 * Both handlers authorize first — a session lookup and a `site_permissions`
 * read, then the editor-token validation — and POST metered only after all of
 * that, while GET (the publish dialog's preview) was not metered at all. The
 * per-site limiters stay behind authorization (an anonymous caller must not
 * spend the customer's budget); this guard is what bounds the authorizer.
 *
 * 200/min per address, shared by GET and POST: a person opens the dialog and
 * clicks Publish. Fails CLOSED: each handler's per-site limiter behind it fails
 * closed too, so in an outage an editor is refused there anyway — failing open
 * here would only hand a flood the authorizer.
 */
function shedIpFlood(request: NextRequest) {
  return enforceRateLimit(request, {
    limit: "IP_GENERAL",
    endpoint: "staging/publish:ip",
    identifierType: "ip",
    onStoreFailure: "deny",
  });
}

function extractElementIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const elementIds = value.filter(
    (elementId): elementId is string => typeof elementId === "string",
  );
  return elementIds.length > 0 ? elementIds : null;
}

export async function POST(request: NextRequest) {
  try {
    const shed = await shedIpFlood(request);
    if (shed) return withPublicCors(shed, request);

    const body = (await request.json()) as Record<string, unknown>;
    const rawSiteId = typeof body.siteId === "string" ? body.siteId : "";

    if (!rawSiteId) {
      return withPublicCors(
        NextResponse.json({ error: "Missing siteId" }, { status: 400 }),
        request,
      );
    }

    const canonical = canonicalSiteId(rawSiteId);
    if (!canonical.ok) {
      return withPublicCors(
        NextResponse.json({ error: canonical.error }, { status: 400 }),
        request,
      );
    }
    const siteId = canonical.value;

    // Shared with the staging content routes so "may this caller publish" is
    // answered by one graded permission model. The check this replaces spelled
    // it `["admin", "owner", "publish"]` inline, inventing an "owner" level the
    // permission model does not have while omitting nothing it does — harmless
    // by luck, and the kind of drift that stops being harmless on the next edit.
    //
    // Asked at "view" rather than "publish" so that a signed-in collaborator
    // who genuinely lacks publish rights is told exactly that, instead of
    // falling through to the token path and being answered "Authentication
    // required" — which is both untrue and unactionable for someone who is
    // plainly signed in.
    const firstPartyAccess = await authorizeFirstPartyEditorAccess(
      siteId,
      "view",
    );
    let publisherEmail: string | null = null;
    let publisherId: string | null = null;

    if (firstPartyAccess) {
      if (!requireEditorPermission(firstPartyAccess, "publish")) {
        return withPublicCors(
          NextResponse.json(
            { error: "Publish permission required" },
            { status: 403 },
          ),
          request,
        );
      }

      publisherEmail = firstPartyAccess.email || null;
      publisherId = firstPartyAccess.userId || null;
    } else {
      const validation = await validateEditorTokenFromRequest({
        request,
        siteId,
        body,
      });

      if (!validation.valid || !validation.access) {
        return withPublicCors(
          NextResponse.json(
            { error: validation.error || "Authentication required" },
            { status: validation.status || 401 },
          ),
          request,
        );
      }

      if (!requireEditorPermission(validation.access, "publish")) {
        return withPublicCors(
          NextResponse.json(
            { error: "Publish permission required" },
            { status: 403 },
          ),
          request,
        );
      }

      publisherEmail =
        validation.access.email ||
        validation.access.userId ||
        validation.access.kind;
      publisherId = validation.access.userId || null;
    }

    // Per site, fail closed, behind the permission grade — the pattern of the
    // per-site limiter on api/content/[siteId]/route.ts:455-473. (ADR 002 rule 4)
    //
    // The RPC below pushes staged copy LIVE on the customer's site with the
    // service-role key. Of everything a leaked invite link opens, this is the
    // one with an audience: it changes what the site's visitors read.
    //
    // 10/min, the tightest ceiling here, because publishing is a human clicking
    // a button — nobody publishes eleven times in a minute, and a legitimate
    // publisher who hits it waits seconds, not minutes.
    //
    // Keyed on the canonical id (s77, s69 R1): every spelling of one site
    // spends this one bucket — see `canonicalSiteId` (src/lib/api/validation.ts).
    const limited = await enforceRateLimit(request, {
      limit: "API_UPLOAD",
      endpoint: "staging/publish",
      identifier: siteId,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "Publish rate limit exceeded for this site.",
    });
    if (limited) return withPublicCors(limited, request);

    // Publishing needs the SITE OWNER's plan (s51, ADR 041): a lapsed owner's
    // editors must not push copy live. Behind authorization and the limiter so
    // it is no oracle for an anonymous caller, and 402 rather than 401/403 so
    // the widget shows the message instead of treating it as "Session ended"
    // and forgetting the edit link — see staging/content/[siteId] PUT.
    const ownerCanEdit = await checkOwnerCanEdit(siteId);
    if (!ownerCanEdit.ok) {
      return withPublicCors(ownerCanEditRefusal(ownerCanEdit), request);
    }

    const elementIds = extractElementIds(body.elementIds);
    const serviceClient = createServiceRoleClient();

    // Publish has always been a site-wide operator action. Page identity scopes
    // what the editor reads and labels the confirmation counts below; it must
    // not scope this mutation. Restore stages every page, and the s27 scoped
    // RPC call once left a restored site half-live when Publish was clicked
    // from only one of those pages.
    const { data, error } = await serviceClient.rpc(
      "publish_staging_content_with_attributes_atomic",
      {
        p_site_id: siteId,
        p_element_ids: elementIds,
        p_published_by: publisherId,
        p_user_email: publisherEmail || "unknown",
      },
    );

    if (error) {
      console.error("Error publishing staging content:", error);
      return withPublicCors(
        NextResponse.json(
          { error: "Failed to publish staging content" },
          { status: 500 },
        ),
        request,
      );
    }

    const publishedRows = (data || []) as PublishRpcRow[];

    if (publishedRows.length > 0) {
      // Deferred, not awaited: the publisher's response must not be gated on a
      // webhook write, let alone on a customer endpoint being reachable (AC 6).
      // `after()` runs this once the response below has already been committed
      // — the same reasoning, and the same primitive, as
      // src/app/api/editor/request-code/route.ts:115.
      //
      // This is a MARKER, not a delivery. It opens or joins a coalescing window
      // (ADR 010); the cron at /api/cron/webhook-dispatch is what actually
      // sends. Doing the send here would put a stranger's HTTP endpoint on the
      // critical path of an edit.
      after(async () => {
        try {
          await webhookManager.recordQualifyingEvent({
            siteId,
            eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
            payload: { elements: publishedRows },
          });
        } catch (webhookError) {
          // Nothing left to shape — the response has already gone. Loud in the
          // logs is all that is available, and all that is wanted.
          console.error(
            `Failed to record webhook event after publish (site: ${siteId}):`,
            webhookError,
          );
        }
      });
    }

    return withPublicCors(
      NextResponse.json({
        success: true,
        published: publishedRows.length,
        elements: publishedRows,
        publishedBy: publisherEmail,
      }),
      request,
    );
  } catch (error) {
    console.error("Error in publish:", error);
    return withPublicCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const shed = await shedIpFlood(request);
    if (shed) return withPublicCors(shed, request);

    const rawSiteId = request.nextUrl.searchParams.get("siteId");
    const requestedPagePath = request.nextUrl.searchParams.get("page_path");
    const normalizedPagePath =
      requestedPagePath === null ? null : normalizePagePath(requestedPagePath);
    if (normalizedPagePath && !normalizedPagePath.ok) {
      return withPublicCors(
        NextResponse.json({ error: normalizedPagePath.error }, { status: 400 }),
        request,
      );
    }
    const pagePath = normalizedPagePath?.value ?? null;

    if (!rawSiteId) {
      return withPublicCors(
        NextResponse.json(
          { error: "Missing siteId parameter" },
          { status: 400 },
        ),
        request,
      );
    }

    const canonical = canonicalSiteId(rawSiteId);
    if (!canonical.ok) {
      return withPublicCors(
        NextResponse.json({ error: canonical.error }, { status: 400 }),
        request,
      );
    }
    const siteId = canonical.value;

    let canPublish = false;
    const firstPartyAccess = await authorizeFirstPartyEditorAccess(
      siteId,
      "view",
    );

    if (firstPartyAccess) {
      canPublish = requireEditorPermission(firstPartyAccess, "publish");
    } else {
      const validation = await validateEditorTokenFromRequest({
        request,
        siteId,
      });

      if (!validation.valid || !validation.access) {
        return withPublicCors(
          NextResponse.json(
            { error: validation.error || "Unauthorized" },
            { status: validation.status || 401 },
          ),
          request,
        );
      }

      if (!requireEditorPermission(validation.access, "view")) {
        return withPublicCors(
          NextResponse.json({ error: "Access denied" }, { status: 403 }),
          request,
        );
      }

      canPublish = requireEditorPermission(validation.access, "publish");
    }

    // s77 (s69 L7). Per site, fail closed, behind the permission grade — ADR 002
    // rule 4, which this service-role read of every element on the site went
    // without. Behind authorization for the reason POST gives: the bucket is the
    // customer's. 100/min: the widget asks once each time the dialog opens.
    const limited = await enforceRateLimit(request, {
      limit: "USER_GENERAL",
      endpoint: "staging/publish-preview",
      identifier: siteId,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "Publish preview rate limit exceeded for this site.",
    });
    if (limited) return withPublicCors(limited, request);

    const serviceClient = createServiceRoleClient();
    const { data: elementsWithChanges, error: fetchError } =
      await fetchPageScopedRows(
        () =>
          serviceClient
            .from("content_elements")
            .select(
              "id, element_id, selector, staging_content, published_content, staging_updated_at, page_path, metadata",
            )
            .eq("site_id", siteId),
        null,
      );

    if (fetchError) {
      console.error("Error fetching staging changes:", fetchError);
      return withPublicCors(
        NextResponse.json(
          { error: "Failed to fetch staging changes" },
          { status: 500 },
        ),
        request,
      );
    }

    const changedRows = (elementsWithChanges || []).flatMap((el) => {
      const projection = stagedMetadata(el.metadata);
      const hasTextChanges =
        el.staging_content !== null &&
        el.staging_content !== el.published_content;
      if (!projection.hasAttributeChanges && !hasTextChanges) {
        return [];
      }

      return [
        {
          pagePath: el.page_path,
          element: {
            id: el.id,
            elementId: el.element_id,
            selector: el.selector,
            stagingContent: el.staging_content,
            publishedContent: el.published_content,
            stagingUpdatedAt: el.staging_updated_at,
            metadata: projection.metadata,
          },
        },
      ];
    });
    const currentPageChanges =
      pagePath === null
        ? changedRows.length
        : changedRows.filter(
            (row) => row.pagePath === null || row.pagePath === pagePath,
          ).length;
    const changedElements = changedRows.map((row) => row.element);

    return withPublicCors(
      NextResponse.json({
        success: true,
        pendingChanges: changedElements.length,
        currentPageChanges,
        otherPageChanges: changedElements.length - currentPageChanges,
        elements: changedElements,
        canPublish,
      }),
      request,
    );
  } catch (error) {
    console.error("Error in publish preview:", error);
    return withPublicCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "GET,POST,OPTIONS");
}
