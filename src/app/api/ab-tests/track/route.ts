import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { authorizeSiteRequest } from "@/lib/security/site-auth";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  coerceText,
  numberOrDefault,
  optionalBoundedString,
  optionalMetadata,
  optionalPlainText,
  readBoundedJson,
  requireEnum,
  requirePlainText,
  requireUuid,
  type ValidationResult,
} from "@/lib/api/validation";

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

const EVENT_TYPES = ["view", "click", "conversion"] as const;

/** An event after validation: ids canonical (lower-case), every field bounded. */
interface TrackEvent {
  site_id: string;
  test_id: string;
  variant_id: string;
  visitor_id: string;
  session_id: string | null;
  event_type: (typeof EVENT_TYPES)[number];
  value: number;
  metadata: Record<string, unknown>;
  geo_country: string | null;
  geo_region: string | null;
}

/*
 * s68b M5 — the bounds. This route is opened by a token published in the
 * customer's page markup; it took any number of events, stored `value` and
 * `metadata` as sent, and 500'd on a malformed id only after reaching the
 * database. Everything below is refused with a 400 BEFORE any database call —
 * the authorizer's `sites` lookup included — except the two fields the host
 * page passes to the public `trackConversion(eventName, value)`, which are
 * coerced rather than refused (see validateEvent):
 *
 * - `value`: a finite number, or a numeric string, in [0, 1,000,000] is kept;
 *   anything else is stored as the default 1.
 * - `metadata.event_name` (re-review N1): a string is kept, a number or a
 *   boolean goes through String(), anything else — null, an object, an array —
 *   becomes "conversion" (never "[object Object]"); control characters are
 *   stripped; the result is cut on a whole character to what fits the
 *   metadata's existing 1 KB bound beside its key. Only a name that is
 *   present is coerced: an absent one stays absent.
 *
 * Metadata is still refused when, name coerced, it breaks a metadata bound —
 * which the embed's `{ event_name }` alone can no longer do.
 *
 * Each bound is set against what the embed actually sends
 * (public/embed/recopyfast.src.js:3437-3495): one event per active test, a
 * conversion's `value || 1` and `{ event_name }`, visitor ids from
 * `crypto.randomUUID()` or `rcf-<ms>-<9 chars>`, geo as a short code or null,
 * delivered by `sendBeacon` (64 KB browser cap). A 400 from real embed traffic
 * after a deploy means a bound is too tight — a bug, not an attack.
 */
const MAX_TRACK_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_EVENT_VALUE = 1_000_000;
/** What the embed itself sends for a conversion without a value (`value || 1`). */
const DEFAULT_EVENT_VALUE = 1;
const MAX_EVENT_METADATA_BYTES = 1024;
/** Flat only: the object, then primitive values (see optionalMetadata). */
const MAX_EVENT_METADATA_DEPTH = 2;
const EVENT_NAME_KEY = "event_name";
/** What a conversion's name becomes when it is not text, a number or a boolean. */
const FALLBACK_EVENT_NAME = "conversion";
/** The name's room in the metadata bound: 1 KB minus `{"event_name":""}`. */
const MAX_EVENT_NAME_JSON_BYTES =
  MAX_EVENT_METADATA_BYTES - JSON.stringify({ [EVENT_NAME_KEY]: "" }).length;
const MAX_ID_TEXT_LENGTH = 64;
const MAX_GEO_LENGTH = 64;

function refuse(error: string) {
  return withCors(NextResponse.json({ error }, { status: 400 }));
}

/**
 * Re-review N1: `metadata` with its `event_name` coerced (rule in the header),
 * as a new object; anything else is returned as received, for the metadata
 * bound to judge. Spread copies own keys as own keys — a `__proto__` key stays
 * one, and the bound still refuses it.
 */
function withCoercedEventName(metadata: unknown): unknown {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    !Object.prototype.hasOwnProperty.call(metadata, EVENT_NAME_KEY)
  ) {
    return metadata;
  }
  const fields = metadata as Record<string, unknown>;
  return {
    ...fields,
    [EVENT_NAME_KEY]: coerceText(fields[EVENT_NAME_KEY], {
      fallback: FALLBACK_EVENT_NAME,
      maxJsonBytes: MAX_EVENT_NAME_JSON_BYTES,
    }),
  };
}

/**
 * Validate one event. Messages name the field, never the value: a refused
 * value is attacker-chosen text and is not echoed (AGENTS.md "Validation").
 */
function validateEvent(raw: unknown): ValidationResult<TrackEvent> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Each event must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;

  const siteId = requireUuid(body, "site_id");
  if (!siteId.ok) return siteId;
  const testId = requireUuid(body, "test_id");
  if (!testId.ok) return testId;
  const variantId = requireUuid(body, "variant_id");
  if (!variantId.ok) return variantId;
  const eventType = requireEnum(body, "event_type", EVENT_TYPES);
  if (!eventType.ok) return eventType;
  const visitorId = requirePlainText(body, "visitor_id", {
    maxLength: MAX_ID_TEXT_LENGTH,
  });
  if (!visitorId.ok) return visitorId;
  const sessionId = optionalPlainText(body, "session_id", {
    maxLength: MAX_ID_TEXT_LENGTH,
  });
  if (!sessionId.ok) return sessionId;

  // Review major 1 (plan amendment 2026-10-08): `value` is the one field that
  // is coerced, never refused. It comes from the host page through the public
  // `window.recopyfast.trackConversion(eventName, value)` (recopyfast.src.js
  // :6255 → :3492 `value: value || 1`), so a string, a negative or a huge
  // number is an ordinary integrator call, not an attack — and refusing it 400'd
  // the whole beacon (one event per active test), which `sendBeacon` ignores:
  // every conversion in it was silently lost. Nothing decides on this column
  // (lifecycle.ts:74), so an unusable value is stored as the default 1.
  const value = numberOrDefault(body, "value", {
    min: 0,
    max: MAX_EVENT_VALUE,
    fallback: DEFAULT_EVENT_VALUE,
  });

  // Re-review N1: `metadata.event_name` is `trackConversion`'s other argument,
  // so it is coerced like `value` before the metadata bounds judge the rest.
  const metadata = optionalMetadata(
    { metadata: withCoercedEventName(body.metadata) },
    "metadata",
    {
      maxBytes: MAX_EVENT_METADATA_BYTES,
      maxDepth: MAX_EVENT_METADATA_DEPTH,
    },
  );
  if (!metadata.ok) return metadata;
  const geoCountry = optionalBoundedString(body, "geo_country", {
    maxLength: MAX_GEO_LENGTH,
  });
  if (!geoCountry.ok) return geoCountry;
  const geoRegion = optionalBoundedString(body, "geo_region", {
    maxLength: MAX_GEO_LENGTH,
  });
  if (!geoRegion.ok) return geoRegion;

  return {
    ok: true,
    value: {
      site_id: siteId.value,
      test_id: testId.value,
      variant_id: variantId.value,
      visitor_id: visitorId.value,
      session_id: sessionId.value ?? null,
      event_type: eventType.value,
      value,
      metadata: metadata.value ?? {},
      geo_country: geoCountry.value || null,
      geo_region: geoRegion.value || null,
    },
  };
}

/** Parse, bound and validate the whole batch; the first refusal wins. */
async function readTrackEvents(
  request: NextRequest,
): Promise<ValidationResult<TrackEvent[]>> {
  const parsed = await readBoundedJson(request, MAX_TRACK_BODY_BYTES);
  if (!parsed.ok) return parsed;

  const batch = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
  if (batch.length === 0) {
    return { ok: false, error: "No events provided" };
  }
  if (batch.length > MAX_EVENTS_PER_BATCH) {
    return {
      ok: false,
      error: `At most ${MAX_EVENTS_PER_BATCH} events per request`,
    };
  }

  const events: TrackEvent[] = [];
  for (const [index, raw] of batch.entries()) {
    const event = validateEvent(raw);
    if (!event.ok) {
      return { ok: false, error: `Event ${index}: ${event.error}` };
    }
    events.push(event.value);
  }
  return { ok: true, value: events };
}

/** Whether a row of this type already exists for (visitor, test). */
async function hasRecordedEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  event: TrackEvent,
  eventType: "view" | "conversion",
): Promise<boolean> {
  const { count, error } = await supabase
    .from("ab_test_results")
    .select("id", { count: "exact", head: true })
    .eq("visitor_id", event.visitor_id)
    .eq("test_id", event.test_id)
    .eq("event_type", eventType);

  if (error)
    throw new Error(`A/B ${eventType} lookup failed: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * Whether the bucket route assigned this visitor a variant of this test.
 *
 * Scoped to the AUTHORIZED site and to a test that `verifyEventsBelongToSite`
 * has already proven is that site's (it runs before this): the service client
 * bypasses RLS, so the filters are the tenant boundary — never a read of
 * another site's assignments.
 */
async function isBucketed(
  supabase: ReturnType<typeof createServiceRoleClient>,
  siteId: string,
  event: TrackEvent,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("visitor_buckets")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId)
    .eq("test_id", event.test_id)
    .eq("visitor_id", event.visitor_id);

  if (error) throw new Error(`A/B bucket lookup failed: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * s68b M5 (owner decision 2026-10-08): one conversion per visitor per test,
 * counted only after that visitor was shown the test.
 *
 * Conversions were counted as rows (lifecycle.ts:56-64) keyed on a
 * `visitor_id` the caller chooses, so one copied token could post conversions
 * until a variant "won" and `promoteWinner` staged it. Now a conversion counts
 * once per visitor, and only for a visitor with proof of exposure. Refused
 * conversions are reported in `deduplicated`, like repeated views.
 *
 * PROOF OF EXPOSURE IS THE BUCKET ROW, a recorded view, or a view in this
 * batch (PR #65 review D1). This first shipped as "a recorded view" only — and
 * the embed sends the view and the conversion as two separate `sendBeacon`
 * calls (`trackImpressions`, recopyfast.src.js:3454-3475; `trackConversion`,
 * :3478-3501). Nothing orders their arrival: a conversion handled before its
 * view committed was refused, and `sendBeacon` never sees the answer, so the
 * conversion was lost for good. The `visitor_buckets` row is written by
 * `GET /api/ab-tests/bucket/[siteId]` before it answers 200 (it 500s when the
 * write fails, bucket/[siteId]/route.ts:209-229), and the embed awaits that
 * answer before either beacon can fire (init, :958-963; bucketVisitor,
 * :3278-3288) — both track methods skip any test the server has not assigned
 * (:3459-3460, :3483-3484). So the row predates every conversion the embed can
 * send. Do not narrow this back to "a recorded view".
 *
 * The one embed path with no row: the bucket call failing on the network
 * (:3306-3359) falls back to client-side assignment, and such a visitor's
 * conversion still needs its view — recorded, or in the same batch.
 */
async function countableConversions(
  supabase: ReturnType<typeof createServiceRoleClient>,
  siteId: string,
  conversions: TrackEvent[],
  views: TrackEvent[],
): Promise<TrackEvent[]> {
  const seen = new Set<string>();
  const countable: TrackEvent[] = [];

  for (const conversion of conversions) {
    const key = `${conversion.visitor_id}:${conversion.test_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const viewedInBatch = views.some(
      (view) =>
        view.visitor_id === conversion.visitor_id &&
        view.test_id === conversion.test_id,
    );
    const exposed =
      viewedInBatch ||
      (await isBucketed(supabase, siteId, conversion)) ||
      (await hasRecordedEvent(supabase, conversion, "view"));
    if (!exposed) continue;
    if (await hasRecordedEvent(supabase, conversion, "conversion")) continue;

    countable.push(conversion);
  }

  return countable;
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
    // s77 (s69 L7). Per IP, BEFORE authorization. The per-site limiter below has
    // to sit behind `authorizeSiteRequest` (an anonymous caller must not spend a
    // customer's bucket), which left the authorizer's `sites` lookup unmetered
    // for anyone naming a site id. 200/min per address: the content GET on the
    // same page view is already behind the same ceiling, so no visitor meets a
    // new one here. Fails CLOSED: every request this route would serve passes
    // the fail-closed per-site limiter anyway, so an outage refuses visitors
    // there regardless — failing open would only hand a flood the authorizer.
    // Ahead of the body read too: a refused beacon is not worth parsing.
    const shed = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "ab-tests/track:ip",
      identifierType: "ip",
      onStoreFailure: "deny",
    });
    if (shed) return withCors(shed);

    // Bounds next: nothing below — authorization included — touches the
    // database for a request that fails them (s68b M5).
    const parsed = await readTrackEvents(request);
    if (!parsed.ok) return refuse(parsed.error);
    const events = parsed.value;

    // All events must share the same site_id (compared canonically).
    const siteId = events[0].site_id;
    if (events.some((e) => e.site_id !== siteId)) {
      return refuse("All events must share the same site_id");
    }

    const token = extractToken(request);

    let authorizedSiteId: string;
    try {
      ({
        site: { id: authorizedSiteId },
      } = await authorizeSiteRequest({
        siteId,
        token,
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
      }));
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
    //
    // s68b M4: keyed on the AUTHORIZED id. The authorizer finds the site through
    // a `uuid` cast (any case) and checks the token against the database's
    // `site.id`, so the upper-case spelling of a real id authorizes with the
    // genuine token — and metering the raw spelling gave every spelling its own
    // bucket. Spellings are still accepted (installed snippets are permanent);
    // they just share the one canonical bucket.
    const limited = await enforceRateLimit(request, {
      limit: "API_KEY_DEFAULT",
      endpoint: "ab-tests/track",
      identifier: authorizedSiteId,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "A/B event rate limit exceeded for this site.",
    });
    if (limited) return withCors(limited);

    const supabase = createServiceRoleClient();

    const ownership = await verifyEventsBelongToSite(
      supabase,
      authorizedSiteId,
      events,
    );
    if (!ownership.ok) {
      return withCors(
        NextResponse.json(
          { error: ownership.error },
          { status: ownership.status },
        ),
      );
    }

    // Clicks are recorded as sent; conversions count once per (visitor, test)
    // for a visitor bucketed into or shown the test (countableConversions);
    // views are deduplicated per (visitor_id, test_id) below.
    const viewEvents = events.filter((e) => e.event_type === "view");
    const clickEvents = events.filter((e) => e.event_type === "click");
    const conversionEvents = events.filter(
      (e) => e.event_type === "conversion",
    );
    const eventsToInsert: TrackEvent[] = [
      ...clickEvents,
      ...(await countableConversions(
        supabase,
        authorizedSiteId,
        conversionEvents,
        viewEvents,
      )),
    ];

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
      session_id: e.session_id,
      event_type: e.event_type,
      value: e.value,
      metadata: e.metadata,
      geo_country: e.geo_country,
      geo_region: e.geo_region,
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
