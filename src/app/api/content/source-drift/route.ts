/**
 * POST /api/content/source-drift — a site admin resolves a developer's deploy
 * that a published override masks (s119, ADR 075).
 *
 * WHAT BROKE. Reported on r/SideProject on 2026-10-21: the page said "5 to 10",
 * the client published "5 to 11", the developer then deployed "5 to 9", and the
 * embed kept writing "5 to 11" with nobody told. Visitors still see the
 * override — un-publishing it on a deploy would be the same silent surprise in
 * the other direction — and the conflict is recorded by the discovery POST
 * (`record_content_source_drift`). This route is where the developer decides:
 *
 * - `keep`: the override stays and becomes measured against "5 to 9", so the
 *   next deploy is flagged against what the developer just accepted.
 * - `drop`: the row is re-discovered at "5 to 9" and is no longer edited, so the
 *   widget stops writing it and the page shows the deploy. One `staging_history`
 *   row (`revert`) records it.
 *
 * THE CHAIN IS ADR 037 / ADR 042, in order, and none of it is optional. No web
 * principal writes `content_elements` (s56), so the write is a service-role RPC,
 * and the service client is created only after: a fail-closed IP limiter (before
 * `getUser()`, which is an auth-server round trip), `getUser()`, a fail-closed
 * per-user limiter, the caller's `admin` row read through their OWN client (RLS
 * still decides what they can see), and the owner's plan (`checkOwnerCanEdit`,
 * s51 — "drop" rewrites the live copy). The RPC is scoped by the site id those
 * checks established, and locks the row before it compares.
 *
 * ONLY AN ADMIN. "Use new source" changes what every visitor reads; "Keep
 * override" silences the flag that protects the developer. Either is the site
 * owner's call, not an editor's.
 *
 * STALE IS 409. `expectedObserved` is the deployed text the admin was shown. If
 * a newer report replaced it since, the RPC answers `conflict` and nothing
 * changes: the admin must see the new text before choosing. A pending draft
 * also refuses "drop" with 409 — publish or discard it first.
 */

import { after, NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  checkOwnerCanEdit,
  ownerCanEditRefusal,
} from "@/lib/billing/owner-can-edit";
import {
  readBoundedJson,
  requireEnum,
  requireUuid,
  type ValidationResult,
} from "@/lib/api/validation";
import {
  MAX_DISCOVERED_TEXT_LENGTH,
  validateVerbatimText,
} from "@/lib/security/discovered-text";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { webhookManager, WEBHOOK_EVENTS } from "@/lib/webhooks/manager";

const RESOLUTIONS = ["keep", "drop"] as const;
type Resolution = (typeof RESOLUTIONS)[number];

/**
 * Room for the largest observation the database can hold: discovery caps text
 * at MAX_DISCOVERED_TEXT_LENGTH characters, and JSON may spell each one as a
 * six-byte `\uXXXX` escape. The rest is the three other fields. Refused before
 * parsing, so a caller cannot make this route hold an arbitrary body.
 */
const MAX_BODY_BYTES = MAX_DISCOVERED_TEXT_LENGTH * 6 + 1024;

const FAILURE = "Could not resolve this change. Please try again.";

const REFUSALS: Record<
  "conflict" | "pending" | "missing",
  { status: number; error: string }
> = {
  conflict: {
    status: 409,
    error:
      "The page changed again since you looked. Reload to see what it says now.",
  },
  pending: {
    status: 409,
    error:
      "This element has a draft waiting. Publish or discard it before using the new source.",
  },
  missing: {
    status: 404,
    error: "There is no open source change on this element any more.",
  },
};

interface ResolveRequest {
  siteId: string;
  contentElementId: string;
  resolution: Resolution;
  expectedObserved: string;
}

function parseBody(raw: unknown): ValidationResult<ResolveRequest> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;

  const siteId = requireUuid(body, "siteId");
  if (!siteId.ok) return siteId;
  const contentElementId = requireUuid(body, "contentElementId");
  if (!contentElementId.ok) return contentElementId;
  const resolution = requireEnum(body, "resolution", RESOLUTIONS);
  if (!resolution.ok) return resolution;

  // Verbatim, never trimmed: the RPC compares it byte for byte with the text
  // the widget stored, which is the customer's own page copy, whitespace and
  // all. The same validator and ceiling discovery used to store it.
  const observed = validateVerbatimText(
    body.expectedObserved,
    MAX_DISCOVERED_TEXT_LENGTH,
  );
  if (!observed.ok) {
    return { ok: false, error: `Field "expectedObserved": ${observed.error}` };
  }

  return {
    ok: true,
    value: {
      siteId: siteId.value,
      contentElementId: contentElementId.value,
      resolution: resolution.value,
      expectedObserved: observed.value,
    },
  };
}

/**
 * "Use new source" changes published copy, so it records the same
 * `content.updated` marker `POST /api/staging/publish` records (review m3):
 * integrators that rebuild a static site or a snapshot cache on that webhook
 * would otherwise keep serving the override the admin just dropped. Same
 * helper, same payload shape (`{ elements: [{ element_id, content,
 * attributes }] }`), and the same `after()`: a MARKER, not a delivery (ADR 010),
 * never on the admin's critical path, and a failure is only logged because the
 * answer has already gone.
 *
 * The RPC answers a status only, so the element id is read here, scoped by the
 * same site id. The content is the observed text the RPC just verified and
 * published; no attribute changes.
 */
function recordNewSourcePublished(
  service: ReturnType<typeof createServiceRoleClient>,
  siteId: string,
  contentElementId: string,
  content: string,
): void {
  after(async () => {
    try {
      const { data: row, error } = await service
        .from("content_elements")
        .select("element_id")
        .eq("id", contentElementId)
        .eq("site_id", siteId)
        .maybeSingle();
      if (error || !row) {
        throw new Error(error?.message ?? "content element not found");
      }
      await webhookManager.recordQualifyingEvent({
        siteId,
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: {
          elements: [{ element_id: row.element_id, content, attributes: {} }],
        },
      });
    } catch (webhookError) {
      console.error(
        `content/source-drift: failed to record content.updated after "use new source" (site: ${siteId}):`,
        webhookError,
      );
    }
  });
}

function failure(context: string, error: unknown): NextResponse {
  console.error(`content/source-drift: ${context}`, error);
  return NextResponse.json({ error: FAILURE }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    // ADR 037 step 1. Fails CLOSED: what sits behind this writes
    // content_elements with RLS bypassed.
    const shed = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "content/source-drift:ip",
      identifierType: "ip",
      onStoreFailure: "deny",
    });
    if (shed) return shed;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ADR 037 step 3: per user, before the permission read and the service
    // role. 100 a minute is far above a person working through a list of
    // conflicts one confirmation at a time. Fails CLOSED, as above.
    const limited = await enforceRateLimit(request, {
      limit: "USER_GENERAL",
      endpoint: "content/source-drift",
      identifier: user.id,
      identifierType: "user",
      onStoreFailure: "deny",
      message: "Too many changes resolved. Please try again shortly.",
    });
    if (limited) return limited;

    const read = await readBoundedJson(request, MAX_BODY_BYTES);
    if (!read.ok) {
      return NextResponse.json({ error: read.error }, { status: 400 });
    }
    const parsed = parseBody(read.value);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { siteId, contentElementId, resolution, expectedObserved } =
      parsed.value;

    const { data: permission, error: permissionError } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", siteId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (permissionError) {
      return failure("permission read failed", permissionError);
    }
    if (permission?.permission !== "admin") {
      return NextResponse.json(
        { error: "Only a site admin can resolve source changes." },
        { status: 403 },
      );
    }

    // After the permission read, never before: a plan-ended answer to a
    // stranger would tell anyone holding a site id whether its owner lapsed.
    const ownerCanEdit = await checkOwnerCanEdit(siteId);
    if (!ownerCanEdit.ok) return ownerCanEditRefusal(ownerCanEdit);

    const service = createServiceRoleClient();
    const { data, error } = await service.rpc("resolve_content_source_drift", {
      p_site_id: siteId,
      p_content_element_id: contentElementId,
      p_resolution: resolution,
      p_expected_observed: expectedObserved,
      p_user_email: user.email ?? user.id,
      p_user_id: user.id,
    });
    if (error) return failure("resolve RPC failed", error);
    const status: unknown = data;

    if (status === "resolved") {
      if (resolution === "drop") {
        recordNewSourcePublished(
          service,
          siteId,
          contentElementId,
          expectedObserved,
        );
      }
      return NextResponse.json({ status, resolution });
    }
    if (status === "conflict" || status === "pending" || status === "missing") {
      const refusal = REFUSALS[status];
      return NextResponse.json(
        { error: refusal.error, status },
        { status: refusal.status },
      );
    }
    return failure("unexpected RPC status", status);
  } catch (error) {
    return failure("unexpected error", error);
  }
}
