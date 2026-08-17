import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { authorizeSiteRequest } from "@/lib/security/site-auth";
import { enforceRateLimit } from "@/lib/api/rate-limit";

function extractToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return request.nextUrl.searchParams.get("token");
}

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type",
  );
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return response;
}

interface TrackEvent {
  site_id: string;
  test_id: string;
  variant_id: string;
  visitor_id: string;
  session_id?: string;
  event_type: "view" | "click" | "conversion";
  value?: number;
  metadata?: Record<string, unknown>;
  geo_country?: string;
  geo_region?: string;
}

/** One row of the ownership query below: a test and the variants under it. */
interface OwnedTestRow {
  id: string;
  ab_test_variants: Array<{ id: string }> | null;
}

type OwnershipVerdict =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Every event has to name a test THIS site owns. (H-1)
 *
 * `ab_test_results` has no `site_id` column — see 20260127_ab_testing_v2.sql:8.
 * `test_id` is the only thing tying a result row to a tenant, and it arrived in
 * the request body. `authorizeSiteRequest` above proves the caller holds a token
 * for `siteId`; it says nothing about the ids they then chose to send.
 *
 * What that bought an attacker was not a junk analytics row. The insert is
 * followed by `checkTestCompletion(testId)`, which flips the test to completed
 * and calls `promoteWinner` — and `promoteWinner` reads `site_id` off the *test*
 * row and stages `variant_content` onto that site's `content_elements`
 * (lifecycle.ts:169-195). A caller authorized for site A, naming site B's test,
 * caused a service-role write to site B's staged copy. The token that opens this
 * route ships as a plain attribute in the customer's page markup and the Origin
 * pin is browser-enforced (site-auth.ts:157-174), so holding *a* valid token is
 * not a high bar.
 *
 * ONE QUERY, SET MEMBERSHIP. Not a per-event lookup: the batch names a handful of
 * ids at most, and a single `in` keeps this off the hot path of a page view.
 *
 * THE WHOLE REQUEST IS REFUSED, never filtered. Dropping the foreign events and
 * recording the rest would answer 200 to an attack and leave an honest caller
 * unable to tell what landed. A partial write here is worse than a clear 403.
 *
 * VARIANTS TOO, and for a reason the FK does not cover: `ab_test_results
 * .variant_id` references `ab_test_variants(id)`, which proves the variant
 * exists somewhere — not that it belongs to the test the row is filed under. A
 * mismatched pair is invisible to every aggregation in `checkTestCompletion`
 * (they all filter on test_id AND variant_id) but still counts toward the total
 * that triggers it, so it is a lever on when a content promotion fires. It costs
 * nothing to close: the variant ids come back with the tests in the same query.
 */
async function verifyEventsBelongToSite(
  supabase: ReturnType<typeof createServiceRoleClient>,
  siteId: string,
  events: TrackEvent[],
): Promise<OwnershipVerdict> {
  const requestedTestIds = Array.from(new Set(events.map((e) => e.test_id)));

  const { data, error } = await supabase
    .from("ab_tests")
    .select("id, ab_test_variants(id)")
    .eq("site_id", siteId)
    .in("id", requestedTestIds);

  if (error) {
    // Fail closed. A database that cannot say which tests belong to this site
    // has not said that these ones do. (A malformed id also lands here: it is
    // not a uuid, so Postgres refuses the `in` — and nothing is written.)
    console.error("Error verifying A/B test ownership:", error);
    return { ok: false, status: 500, error: "Failed to record events" };
  }

  const variantsByTest = new Map<string, Set<string>>(
    ((data ?? []) as OwnedTestRow[]).map((test) => [
      test.id,
      new Set((test.ab_test_variants ?? []).map((variant) => variant.id)),
    ]),
  );

  for (const event of events) {
    const variants = variantsByTest.get(event.test_id);
    if (!variants || !variants.has(event.variant_id)) {
      return {
        ok: false,
        status: 403,
        error: "Events must reference a test and variant owned by this site",
      };
    }
  }

  return { ok: true };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const events: TrackEvent[] = Array.isArray(body) ? body : [body];

    if (events.length === 0) {
      return withCors(
        NextResponse.json({ error: "No events provided" }, { status: 400 }),
      );
    }

    // All events must share the same site_id
    const siteId = events[0].site_id;
    if (!siteId || events.some((e) => e.site_id !== siteId)) {
      return withCors(
        NextResponse.json(
          { error: "All events must share the same site_id" },
          { status: 400 },
        ),
      );
    }

    const token = extractToken(request);

    try {
      await authorizeSiteRequest({
        siteId,
        token,
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
      });
    } catch (authError) {
      return withCors(
        NextResponse.json(
          {
            error:
              authError instanceof Error ? authError.message : "Unauthorized",
          },
          { status: 401 },
        ),
      );
    }

    // Per site, fail closed, behind authorization — the pattern and the reasoning
    // of the per-site limiter on api/content/[siteId]/route.ts:455-473, which is
    // the other service-role write a published site token opens. (ADR 002 rule 4)
    //
    // BEHIND the auth call, not in front of it, even though AGENTS.md says to
    // meter first: this bucket is the site's own, and metering an unauthenticated
    // caller into it would let anyone spend a customer's budget by naming their
    // site id — locking that customer's real widget out. Metering per IP instead
    // would not bound what one copied token can do, which is the point here.
    //
    // 1000/min is deliberately generous: this is telemetry from ordinary page
    // views, batched by the widget, and a refused batch is data lost for good.
    // It still caps a copied token at a rate no honest visitor produces.
    const limited = await enforceRateLimit(request, {
      limit: "API_KEY_DEFAULT",
      endpoint: "ab-tests/track",
      identifier: siteId,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "A/B event rate limit exceeded for this site.",
    });
    if (limited) return withCors(limited);

    const supabase = createServiceRoleClient();

    // Validate required fields
    for (const event of events) {
      if (
        !event.test_id ||
        !event.variant_id ||
        !event.visitor_id ||
        !event.event_type
      ) {
        return withCors(
          NextResponse.json(
            {
              error:
                "Each event requires: test_id, variant_id, visitor_id, event_type",
            },
            { status: 400 },
          ),
        );
      }
    }

    const ownership = await verifyEventsBelongToSite(supabase, siteId, events);
    if (!ownership.ok) {
      return withCors(
        NextResponse.json(
          { error: ownership.error },
          { status: ownership.status },
        ),
      );
    }

    // Deduplicate view events: check existing views per (visitor_id, test_id, variant_id)
    const viewEvents = events.filter((e) => e.event_type === "view");
    const nonViewEvents = events.filter((e) => e.event_type !== "view");
    const eventsToInsert: TrackEvent[] = [...nonViewEvents];

    if (viewEvents.length > 0) {
      const viewChecks = viewEvents.map((e) => ({
        visitor_id: e.visitor_id,
        test_id: e.test_id,
      }));

      // Check for existing views
      const uniqueChecks = Array.from(
        new Map(
          viewChecks.map((c) => [`${c.visitor_id}:${c.test_id}`, c]),
        ).values(),
      );

      for (const check of uniqueChecks) {
        const { count } = await supabase
          .from("ab_test_results")
          .select("id", { count: "exact", head: true })
          .eq("visitor_id", check.visitor_id)
          .eq("test_id", check.test_id)
          .eq("event_type", "view");

        if ((count ?? 0) === 0) {
          // No existing view — add view events for this visitor+test
          const matching = viewEvents.filter(
            (e) =>
              e.visitor_id === check.visitor_id && e.test_id === check.test_id,
          );
          eventsToInsert.push(...matching);
        }
      }
    }

    if (eventsToInsert.length === 0) {
      return withCors(
        NextResponse.json({ recorded: 0, deduplicated: events.length }),
      );
    }

    // Insert events
    const rows = eventsToInsert.map((e) => ({
      test_id: e.test_id,
      variant_id: e.variant_id,
      visitor_id: e.visitor_id,
      session_id: e.session_id || null,
      event_type: e.event_type,
      value: e.value ?? 1,
      metadata: e.metadata ?? {},
      geo_country: e.geo_country || null,
      geo_region: e.geo_region || null,
    }));

    const { error } = await supabase.from("ab_test_results").insert(rows);

    if (error) {
      console.error("Error recording A/B test events:", error);
      return withCors(
        NextResponse.json(
          { error: "Failed to record events" },
          { status: 500 },
        ),
      );
    }

    // Every 50th view event, trigger inline significance check.
    //
    // `testId` is safe to pass on ONLY because the whole batch was refused above
    // unless every test_id in it belongs to `siteId`. This call is what reaches
    // `promoteWinner` and writes staged content, so if the check above is ever
    // relaxed to filter events rather than refuse the request, this line becomes
    // a cross-tenant content write again — the batch would still carry the
    // foreign id, and the first view event is not necessarily one that survived
    // the filter.
    if (viewEvents.length > 0) {
      const testId = viewEvents[0].test_id;
      const { count: totalViews } = await supabase
        .from("ab_test_results")
        .select("id", { count: "exact", head: true })
        .eq("test_id", testId)
        .eq("event_type", "view");

      if (totalViews && totalViews % 50 < eventsToInsert.length) {
        // Lazy import to avoid circular deps
        try {
          const { checkTestCompletion } = await import(
            "@/lib/ab-testing/lifecycle"
          );
          await checkTestCompletion(testId);
        } catch (e) {
          console.error("Inline significance check failed:", e);
        }
      }
    }

    return withCors(
      NextResponse.json({
        recorded: eventsToInsert.length,
        deduplicated: events.length - eventsToInsert.length,
      }),
    );
  } catch (error) {
    console.error("Track A/B test error:", error);
    return withCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
    );
  }
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}
