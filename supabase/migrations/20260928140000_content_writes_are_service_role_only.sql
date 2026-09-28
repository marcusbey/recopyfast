-- ============================================================
-- Content tables: no web principal writes them directly (s56, ADR 042)
-- ============================================================
-- THE INCIDENT. s51 put the site owner's plan in front of every application
-- write (`checkOwnerCanEdit`, ADR 041). Its review (docs/reviews/s51-…md,
-- finding 1) then went around the application: it signed up, took the `admin`
-- row of a site whose owner had NO plan, and sent
--
--   PATCH /rest/v1/content_elements?id=eq.<row>   (the member's own JWT)
--
-- straight to PostgREST. Answer: 200, and the live `published_content`
-- changed. The route gate was never on that path. Two things made it possible,
-- and both were live in production:
--
--   - write POLICIES for any `edit`/`admin` member: "Users can edit content for
--     authorized sites" (FOR ALL, to PUBLIC) on content_elements, and
--     "Site editors can create/update/delete …" on ab_tests and
--     ab_test_variants (the A/B variant content is served to visitors);
--   - write GRANTS: `anon` and `authenticated` held Supabase's default
--     `arwdDxt(m)` on these tables. No migration granted them; none revoked
--     them.
--
-- WHY A REVOKE AND NOT A PLAN PREDICATE IN THE POLICIES. The predicate would
-- have to restate `resolveEntitlement`'s `plan` rule in SQL — entitlement
-- revocation, expiry, trial and offer sources, lifetime purchases, live
-- subscription statuses, retired plan ids, the catalogue's active flag. ADR 040
-- (:79-81, after ADR 035) already refused exactly that: "the plan, trial and
-- window rules would exist twice and drift". Its failure mode is also the worst
-- available — TypeScript says `plan`, SQL says no, and a paying owner's bulk
-- rows fail one by one. No product surface writes these tables with a user
-- JWT any more: the four routes that did (bulk update, bulk import, translate,
-- ab-tests POST/PUT) now write through the service client after authorization
-- and the gate. So no direct write is legitimate, a paying member's included,
-- and `checkOwnerCanEdit` stays the single enforcement point.
--
-- WHY THE GRANT GOES AS WELL AS THE POLICY.
--   - TRUNCATE ignores RLS entirely. PostgREST exposes none today, but a policy
--     drop alone leaves it granted.
--   - With only the policy gone, PostgREST answers a PATCH or DELETE with 200
--     and an empty body (RLS filters silently). With the grant gone it answers
--     403 / 42501: a refusal that says so.
--   - It closes pg_graphql and any future Data API surface too, which read the
--     grant, not the route.
-- Privileges are ENUMERATED, never `REVOKE ALL PRIVILEGES`: that would take
-- SELECT, which the member SELECT policies, the dashboard and the A/B screens
-- read through. `MAINTAIN` is not named either: it exists from PostgreSQL 17
-- only, and every migration is also parsed on PostgreSQL 14
-- (scripts/run-db-invariants.mjs). `authenticated` keeping it is harmless —
-- PostgREST cannot issue VACUUM, ANALYZE or REINDEX.
--
-- THE TABLES WHOSE POLICIES WERE ALREADY CLOSED. content_versions,
-- content_history, staging_history, ab_test_results, visitor_buckets and
-- conversion_events already refused a web principal's write in production
-- (service_role-only write policies). Their grants are revoked anyway, so the
-- invariant is one list-wide rule (src/__tests__/db/content-write-privileges
-- .test.ts) and the next permissive policy on any of them is not immediately
-- reachable. Two write policies exist only on a database REPLAYED from these
-- files, never in production, because the files that create them aborted there
-- (see 20260818010000's header): "Site editors can insert content versions"
-- (20260611020000:129) and "Site editors can append content history"
-- (20260731008000:341). They are dropped here too, so a replayed database —
-- local and CI — ends in the same state as production.
--
-- `service_role` is GRANTED its DML explicitly. The moved routes make it
-- load-bearing, and a local image has been measured holding only `Dxt` on
-- content_elements for every role (update-history-policy.test.ts). Idempotent
-- in production, where it already holds them.
--
-- DEPLOY ORDER: CODE FIRST, THEN THIS MIGRATION — the reverse of
-- docs/operations/founding-offer.md. This migration breaks the OLD code's four
-- user-JWT writes (dashboard bulk import and update are live). The NEW code
-- works on either schema, because `service_role` holds DML on both. Runbook:
-- docs/operations/content-writes-service-role.md.
-- ============================================================

-- 1. The user write policies.
DROP POLICY IF EXISTS "Users can edit content for authorized sites" ON public.content_elements;

DROP POLICY IF EXISTS "Site editors can create ab_tests" ON public.ab_tests;
DROP POLICY IF EXISTS "Site editors can update ab_tests" ON public.ab_tests;
DROP POLICY IF EXISTS "Site editors can delete ab_tests" ON public.ab_tests;

DROP POLICY IF EXISTS "Site editors can create ab_test_variants" ON public.ab_test_variants;
DROP POLICY IF EXISTS "Site editors can update ab_test_variants" ON public.ab_test_variants;
DROP POLICY IF EXISTS "Site editors can delete ab_test_variants" ON public.ab_test_variants;

-- Replayed databases only (see the header); a no-op in production.
DROP POLICY IF EXISTS "Site editors can insert content versions" ON public.content_versions;
DROP POLICY IF EXISTS "Site editors can append content history" ON public.content_history;

-- 2. The web principals' write grants. SELECT is untouched.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.content_elements,
     public.content_versions,
     public.content_history,
     public.staging_history,
     public.ab_tests,
     public.ab_test_variants,
     public.ab_test_results,
     public.visitor_buckets,
     public.conversion_events
  FROM PUBLIC, anon, authenticated;

-- 3. The one principal that writes them, explicitly.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.content_elements,
     public.content_versions,
     public.content_history,
     public.staging_history,
     public.ab_tests,
     public.ab_test_variants,
     public.ab_test_results,
     public.visitor_buckets,
     public.conversion_events
  TO service_role;
