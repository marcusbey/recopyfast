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

type PublishRpcRow = {
  element_id: string;
  content: string | null;
};

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
    const body = (await request.json()) as Record<string, unknown>;
    const siteId = typeof body.siteId === "string" ? body.siteId : "";

    if (!siteId) {
      return withPublicCors(
        NextResponse.json({ error: "Missing siteId" }, { status: 400 }),
        request,
      );
    }

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
    const limited = await enforceRateLimit(request, {
      limit: "API_UPLOAD",
      endpoint: "staging/publish",
      identifier: siteId,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "Publish rate limit exceeded for this site.",
    });
    if (limited) return withPublicCors(limited, request);

    const elementIds = extractElementIds(body.elementIds);
    const serviceClient = createServiceRoleClient();
    const { data, error } = await serviceClient.rpc(
      "publish_staging_content_atomic",
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
    const siteId = request.nextUrl.searchParams.get("siteId");

    if (!siteId) {
      return withPublicCors(
        NextResponse.json(
          { error: "Missing siteId parameter" },
          { status: 400 },
        ),
        request,
      );
    }

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

    const serviceClient = createServiceRoleClient();
    const { data: elementsWithChanges, error: fetchError } = await serviceClient
      .from("content_elements")
      .select(
        "id, element_id, selector, staging_content, published_content, staging_updated_at, metadata",
      )
      .eq("site_id", siteId)
      .not("staging_content", "is", null);

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

    const changedElements = (elementsWithChanges || [])
      .filter((el) => el.staging_content !== el.published_content)
      .map((el) => ({
        id: el.id,
        elementId: el.element_id,
        selector: el.selector,
        stagingContent: el.staging_content,
        publishedContent: el.published_content,
        stagingUpdatedAt: el.staging_updated_at,
        metadata: el.metadata,
      }));

    return withPublicCors(
      NextResponse.json({
        success: true,
        pendingChanges: changedElements.length,
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
