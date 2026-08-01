-- ========================================
-- The ten tables 20250817000000 never actually created
-- ========================================
-- 20250817000000_complete_database_setup.sql defines 25 tables. Only 15 of them
-- exist in the production database. Probing the live schema with the service
-- role shows these ten missing:
--
--   ab_test_variants, ab_tests, billing_invoices, billing_payment_methods,
--   billing_ticket_usage, billing_tickets, collaboration_sessions,
--   performance_metrics, team_activity, team_invitations
--
-- WHY WE GO FORWARD INSTEAD OF REPLAYING 20250817000000
-- -----------------------------------------------------
-- The obvious repair — mark the base migration un-applied and re-run it — does
-- not work. Every CREATE TABLE in that file is guarded with IF NOT EXISTS, but
-- its eight CREATE POLICY statements are not, and PostgreSQL has no
-- CREATE POLICY IF NOT EXISTS. Replaying it would abort with 42710
-- ("policy already exists for table") on the first policy belonging to one of
-- the 15 tables that *do* exist — sites, content_elements, billing_customers,
-- billing_subscriptions, api_keys, edit_sessions. The migration runs in a single
-- transaction, so the abort rolls back the ten CREATE TABLEs we actually wanted.
-- It fails the same way on every retry.
--
-- So 20250817000000 stays marked applied and untouched, and this file creates
-- only what is missing. It is additive and re-runnable: IF NOT EXISTS on every
-- table and index, DROP POLICY IF EXISTS before every CREATE POLICY.
--
-- THE PART THAT IS EASY TO GET WRONG: FOLDING IN THE LATER MIGRATIONS
-- ------------------------------------------------------------------
-- These ten tables are not just absent from 20250817000000's era — they are
-- absent from the whole chain that followed. Six later migrations ALTER them,
-- and each of those six is already marked APPLIED in the ledger, so none will
-- ever run again. Whatever they would have added has to be baked into the
-- CREATE TABLE statements below or the schema will not match what the
-- application code expects.
--
-- Worth stating plainly, because it explains why so much is folded in here:
-- those six migrations cannot merely have "partly" applied. Supabase wraps each
-- migration in a transaction, and each of the six touches one of the ten
-- missing tables, so each one aborted and rolled back in full:
--
--   20260127_ab_testing_v2.sql          CREATE TABLE ab_test_results
--                                       REFERENCES ab_tests → 42P01
--   20260611010000_rls_hardening.sql    first statement is
--                                       ALTER TABLE billing_payment_methods → 42P01
--   20260611020000_tighten_…            DROP POLICY … ON ab_test_results → 42P01
--   20260731005000_analytics_alignment  ALTER TABLE performance_metrics → 42P01
--   20260731006000_ab_testing_alignment first statement is
--                                       ALTER TABLE ab_tests → 42P01
--   20260731007000_rls_analytics_…      ALTER TABLE performance_metrics → 42P01
--   20260731008000_rls_policies_…       DROP POLICY … ON team_invitations → 42P01
--
-- Everything those migrations intended *for these ten tables* is reproduced
-- here: the added columns, the relaxed NOT NULLs, the renamed CHECK, the
-- indexes, the ab_test_variants sync trigger, and the full RLS policy set. Each
-- folded-in item is attributed inline to the migration it came from.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT FIX
-- ----------------------------------------
-- Those same seven rollbacks also dropped work aimed at tables *outside* this
-- file's scope, and that work is still missing:
--
--   • ab_test_results and visitor_buckets (20260127) were never created. The
--     A/B pipeline reads and writes both — src/app/api/ab-tests/track/route.ts,
--     .../bucket/[siteId]/route.ts, src/lib/ab-testing/lifecycle.ts:43 — so
--     creating ab_tests here is necessary but not sufficient for that feature.
--   • user_activity_logs and site_analytics never got their aligned columns
--     (action_type, timestamp, avg_load_time, …) and update_site_analytics()
--     was never defined (20260731005000).
--   • site_permissions, teams, team_members, domain_verifications and
--     content_history still have RLS enabled with zero policies
--     (20260731008000), which is a total lockout for anon-key clients. That
--     matters directly to the policies below: every "Site members can view …"
--     policy here is an EXISTS over site_permissions, and RLS applies
--     recursively inside policy subqueries, so those reads stay empty for real
--     users until site_permissions has a SELECT policy again. See the header of
--     20260731008000 for the full explanation.
--   • security_events and rate_limits never got RLS enabled (20260611010000).
--
-- Those need their own forward migration; they are named here so the gap is
-- recorded rather than rediscovered.
-- ========================================

-- ============================================================
-- 0. Preflight
-- ============================================================
-- Every foreign key below points at a table this file does not create. All of
-- them were verified present in production, but asserting it up front turns a
-- missing prerequisite into one legible error instead of a 42P01 from whichever
-- CREATE TABLE happens to hit it first. The whole file is one transaction, so
-- raising here leaves the database exactly as it was.
DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_table   TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.sites',
    'public.content_elements',
    'public.site_permissions',
    'public.billing_customers',
    'public.billing_subscriptions',
    'public.teams',
    'public.team_members'
  ] LOOP
    IF to_regclass(v_table) IS NULL THEN
      v_missing := array_append(v_missing, v_table);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'Cannot create the missing base tables: prerequisite table(s) absent: %',
      array_to_string(v_missing, ', ');
  END IF;
END
$$;

-- ============================================================
-- 1. Helper used by the team_invitations policies
-- ============================================================
-- 20260731008000 defines this, but that migration rolled back (see header), so
-- it does not exist in production even though the ledger says otherwise. The
-- team_invitations policies at the bottom of this file call it by name, so it
-- has to be here. Copied verbatim; CREATE OR REPLACE is a no-op if a future
-- repair of 20260731008000 creates it first.
--
-- SECURITY DEFINER is load-bearing: team_members currently has RLS enabled with
-- no policies, so a plain EXISTS subquery against it returns nothing for every
-- authenticated caller. The definer context bypasses that.
CREATE OR REPLACE FUNCTION public.user_has_team_role(
  p_team_id UUID,
  p_roles   TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = p_team_id
      AND tm.user_id = auth.uid()
      AND tm.role = ANY(p_roles)
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_has_team_role(UUID, TEXT[]) TO authenticated, service_role;

-- ============================================================
-- 2. BILLING
-- ============================================================

-- ------------------------------------------------------------
-- billing_payment_methods
-- ------------------------------------------------------------
-- No folded-in changes: no later migration touches this table's columns.
-- src/app/api/billing/payment-methods/route.ts:190 notes the mirror is not read
-- anywhere — cards come straight from Stripe — but the table is part of the
-- declared schema and the RLS policies below reference it, so it is created.
CREATE TABLE IF NOT EXISTS billing_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES billing_customers(id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'card',
  card_last4 TEXT,
  card_brand TEXT,
  card_exp_month INTEGER,
  card_exp_year INTEGER,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_payment_methods_customer_id
  ON billing_payment_methods(customer_id);

-- ------------------------------------------------------------
-- billing_invoices
-- ------------------------------------------------------------
-- The status CHECK is left exactly as 20250817000000 declared it. That is
-- deliberate and is called out in 20260731009000:19 — 'draft','open','paid',
-- 'void','uncollectible' already is Stripe's complete invoice status enum, so
-- unlike billing_subscriptions.status it needs no widening.
CREATE TABLE IF NOT EXISTS billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES billing_customers(id),
  subscription_id UUID REFERENCES billing_subscriptions(id),
  stripe_invoice_id TEXT UNIQUE NOT NULL,
  amount_paid INTEGER NOT NULL,
  amount_due INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  invoice_pdf TEXT,
  hosted_invoice_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ------------------------------------------------------------
-- billing_tickets
-- ------------------------------------------------------------
-- Note this is the pay-per-use *purchase record* table from the base migration,
-- not the wallet. The wallet is `tickets` + `ticket_transactions`, created by
-- 20260617001000_ticket_wallet_compat.sql, which already exists in production
-- and is what add_tickets() writes to. Nothing in src/ reads billing_tickets
-- today; it is created for schema completeness and because
-- billing_ticket_usage.ticket_id points at it.
CREATE TABLE IF NOT EXISTS billing_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_type TEXT NOT NULL CHECK (ticket_type IN ('ai_generation', 'translation', 'bulk_operation')),
  quantity INTEGER DEFAULT 1,
  unit_cost INTEGER NOT NULL, -- in cents
  total_cost INTEGER NOT NULL, -- in cents
  stripe_payment_intent_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_tickets_user_id ON billing_tickets(user_id);

-- ------------------------------------------------------------
-- billing_ticket_usage
-- ------------------------------------------------------------
-- Must come after billing_tickets: ticket_id references it.
CREATE TABLE IF NOT EXISTS billing_ticket_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES billing_tickets(id),
  feature_used TEXT NOT NULL,
  quantity_consumed INTEGER DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 3. COLLABORATION
-- ============================================================

-- ------------------------------------------------------------
-- team_invitations
-- ------------------------------------------------------------
-- SCHEMA/CODE MISMATCH, RESOLVED BY CARRYING BOTH SPELLINGS
-- --------------------------------------------------------
-- 20250817000000:246 names the inviter column `inviter_id`. Nothing in the
-- codebase has ever used that name. The application was written against the
-- loose supabase/collaboration-schema.sql:33, which calls it `invited_by`:
--
--   src/app/api/teams/[teamId]/invitations/route.ts:231  insert invited_by
--   src/app/api/teams/invitations/accept/route.ts:108    reads invited_by
--   src/types/index.ts:105                               TeamInvitation.invited_by
--
-- and two PostgREST embed hints name the foreign key explicitly:
--
--   src/app/api/teams/[teamId]/invitations/route.ts:49 and :237
--     inviter:auth.users!team_invitations_invited_by_fkey(...)
--
-- No migration ever reconciled the two. Creating the table with `inviter_id`
-- alone would produce a table that exists but that POST /api/teams/[teamId]/
-- invitations cannot insert into and that GET cannot select from — the FK the
-- embed hint names would not exist. So both columns are declared: `inviter_id`
-- faithfully from the base migration, `invited_by` (nullable, no NOT NULL) for
-- the code. Declaring `invited_by` inline yields exactly the constraint name
-- team_invitations_invited_by_fkey that the embed hints require.
--
-- This follows the precedent already set twice in this directory for the same
-- class of problem: 20260731000000 carries both `permission` and `role` on
-- site_permissions, and 20260731006000 carries both (name, variant_content) and
-- (variant_name, content) on ab_test_variants. Like those, it is a shim.
--
-- NOTE FOR FOLLOW-UP: `inviter_id` and `invited_by` are the same fact. The
-- application should converge on `invited_by` and `inviter_id` should then be
-- dropped. It is kept only so the schema still matches its declared source.
--
-- The base migration's UNIQUE(team_id, email) from the loose schema is
-- intentionally NOT reproduced — 20250817000000 does not declare it, and it
-- would block re-inviting an address after a declined or expired invitation.
-- The duplicate check lives in application code at route.ts:190.
CREATE TABLE IF NOT EXISTS team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  inviter_id UUID REFERENCES auth.users(id),
  invited_by UUID REFERENCES auth.users(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'manager')),
  -- The base migration writes this as encode(gen_random_bytes(32), 'hex').
  -- gen_random_bytes() comes from pgcrypto, which on this project is not on the
  -- search_path for the migration role: pushing that form fails with
  --   ERROR: function gen_random_bytes(integer) does not exist (SQLSTATE 42883)
  -- and, because a migration runs in one transaction, takes the whole file with
  -- it. (It survives in older migrations only because those were applied by
  -- hand through the dashboard, where the extensions schema *is* in scope.)
  --
  -- gen_random_uuid() is core PostgreSQL since 13 and needs no extension. Two
  -- of them, hyphens stripped and concatenated, give the same 64 lowercase hex
  -- characters with the same 256 bits of entropy, so the column's shape and
  -- unguessability are unchanged and no extension is depended upon.
  token TEXT UNIQUE NOT NULL DEFAULT (
    replace(gen_random_uuid()::text, '-', '') ||
    replace(gen_random_uuid()::text, '-', '')
  ),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_invitations_email ON team_invitations(email);

-- ------------------------------------------------------------
-- team_activity
-- ------------------------------------------------------------
-- Distinct from team_activity_log, which 20260731001000 created and which the
-- collaboration code actually uses. That migration's header (lines 9-18) makes
-- the split explicit: team_activity is the base migration's design, kept for
-- schema completeness; team_activity_log is the shape the application writes.
-- Nothing in src/ references team_activity.
CREATE TABLE IF NOT EXISTS team_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  activity_type TEXT NOT NULL CHECK (activity_type IN ('member_added', 'member_removed', 'role_changed', 'content_edited', 'site_added', 'site_removed')),
  entity_type TEXT CHECK (entity_type IN ('user', 'site', 'content', 'team')),
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ------------------------------------------------------------
-- collaboration_sessions
-- ------------------------------------------------------------
-- Presence for the realtime editor. Nothing in src/ references it today —
-- presence currently rides on Socket.io in server/index.js rather than being
-- persisted — but it carries RLS policies from 20260611010000, reproduced below.
CREATE TABLE IF NOT EXISTS collaboration_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  cursor_position JSONB,
  current_element TEXT,
  metadata JSONB DEFAULT '{}',
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collaboration_sessions_site_user
  ON collaboration_sessions(site_id, user_id);

-- ============================================================
-- 4. ANALYTICS
-- ============================================================

-- ------------------------------------------------------------
-- performance_metrics
-- ------------------------------------------------------------
-- Folds in every change 20260731005000 would have made:
--   • metadata JSONB — src/lib/analytics/tracker.ts:91 writes it
--   • metric_name loses NOT NULL — the tracker never supplies it
--   • the metric_type CHECK is created directly in its final, widened form,
--     named performance_metrics_metric_type_check exactly as 20260731005000
--     names it, accepting both the code vocabulary
--     ('load_time','edit_time','api_response_time' — see METRIC_TYPES in
--     src/app/api/analytics/performance/route.ts:24) and the base migration's
--     ('page_load','api_response','database_query','websocket_latency').
--     Declaring it named up front avoids the find-the-unnamed-constraint dance
--     that 20260731005000 had to perform against an existing table.
--
-- KNOWN MISMATCH, LEFT AS DECLARED: `value DECIMAL(10,3)` caps at 9,999,999.999,
-- but /api/analytics/performance validates against MAX_METRIC_VALUE =
-- 24*60*60*1000 = 86,400,000 (route.ts:32), so an accepted value above ~10^7 ms
-- raises "numeric field overflow" on insert. Real page-load and API timings are
-- orders of magnitude below that, so this is latent rather than live; the type is
-- kept as 20250817000000 declared it because no later migration widened it.
-- Widening to DECIMAL(14,3) belongs in its own migration.
CREATE TABLE IF NOT EXISTS performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,
  metric_name TEXT,
  value DECIMAL(10,3) NOT NULL,
  unit TEXT DEFAULT 'ms',
  labels JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT performance_metrics_metric_type_check
    CHECK (metric_type IN (
      -- vocabulary used by src/lib/analytics/tracker.ts + /api/analytics/performance
      'load_time', 'api_response_time', 'edit_time',
      -- legacy vocabulary from 20250817000000_complete_database_setup.sql
      'page_load', 'api_response', 'database_query', 'websocket_latency'
    ))
);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_site_type
  ON performance_metrics(site_id, metric_type);

-- From 20260731005000: /api/analytics/performance orders by recorded_at DESC.
CREATE INDEX IF NOT EXISTS idx_performance_metrics_site_recorded
  ON performance_metrics(site_id, recorded_at DESC);

-- ============================================================
-- 5. A/B TESTING
-- ============================================================

-- ------------------------------------------------------------
-- ab_tests
-- ------------------------------------------------------------
-- Three generations of schema collapsed into one CREATE TABLE:
--   base 20250817000000  — traffic_allocation, winner_variant, …
--   20260127_ab_testing_v2 — target_element_id, auto_complete, min_sample_size,
--                            confidence_threshold (all read by
--                            src/lib/ab-testing/lifecycle.ts:33-34 and
--                            /api/ab-tests/active/[siteId])
--   20260731006000        — traffic_split, success_metric, created_by (all
--                            written by /api/ab-tests/route.ts:162 and
--                            /api/ab-tests/generate/route.ts:140)
--
-- traffic_allocation and traffic_split are the same fact in two generations;
-- 20260731006000's header flags the convergence as follow-up work. Only
-- traffic_split is written by current code. Both are kept so the table matches
-- its declared sources.
--
-- Declaring created_by inline produces the constraint name
-- ab_tests_created_by_fkey, matching what 20260731006000:41 adds explicitly.
CREATE TABLE IF NOT EXISTS ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  traffic_allocation DECIMAL(3,2) DEFAULT 0.50,
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  winner_variant TEXT,
  statistical_significance DECIMAL(5,2),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- folded in from 20260127_ab_testing_v2.sql:28-31
  target_element_id TEXT,
  auto_complete BOOLEAN DEFAULT true,
  min_sample_size INTEGER DEFAULT 100,
  confidence_threshold DECIMAL(3,2) DEFAULT 0.95,
  -- folded in from 20260731006000_ab_testing_schema_alignment.sql:34-42
  traffic_split DECIMAL DEFAULT 0.5,
  success_metric TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ab_tests_site_status ON ab_tests(site_id, status);
CREATE INDEX IF NOT EXISTS idx_ab_tests_created_by ON ab_tests(created_by);

-- ------------------------------------------------------------
-- ab_test_variants
-- ------------------------------------------------------------
-- Must come after ab_tests: test_id references it.
--
-- Two column pairs describe the same variant, because two code paths were
-- written against two schema generations:
--   (name, variant_content)   — read by the embed endpoint
--                               /api/ab-tests/active/[siteId]/route.ts:57,
--                               written by /api/ab-tests/generate/route.ts:195
--   (variant_name, content)   — written by the dashboard
--                               /api/ab-tests/route.ts:191
-- The sync trigger at the end of this section keeps them equal on write. Both
-- pairs, and the trigger, are from 20260731006000; its header documents the
-- convergence as follow-up work.
--
-- NULLABILITY. The base migration declares `name TEXT NOT NULL` and
-- `content_changes JSONB NOT NULL`, and 20260127 declares
-- `variant_content TEXT NOT NULL DEFAULT ''`. 20260731006000:94-113 drops all
-- three NOT NULLs and gives content_changes a '{}' default, because the
-- dashboard insert supplies none of them. Since 20260731006000 runs after
-- 20260127, the settled end state is what is written below: all three nullable,
-- content_changes defaulting to '{}', variant_content defaulting to ''.
CREATE TABLE IF NOT EXISTS ab_test_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID REFERENCES ab_tests(id) ON DELETE CASCADE,
  name TEXT,
  content_changes JSONB DEFAULT '{}'::jsonb,
  traffic_percentage DECIMAL(5,2) DEFAULT 50.00,
  conversions INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  conversion_rate DECIMAL(5,2) DEFAULT 0.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- folded in from 20260127_ab_testing_v2.sql:34-37
  variant_content TEXT DEFAULT '',
  is_control BOOLEAN DEFAULT false,
  geo_countries TEXT[],
  geo_regions TEXT[],
  -- folded in from 20260731006000_ab_testing_schema_alignment.sql:70-78
  content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE,
  variant_name TEXT,
  content TEXT
);

CREATE INDEX IF NOT EXISTS idx_ab_test_variants_test_id ON ab_test_variants(test_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_variants_content_element_id
  ON ab_test_variants(content_element_id);

-- COMPAT SHIM, from 20260731006000:135-149 (remove once the two creation routes
-- converge on one column pair). /api/ab-tests/route.ts:191 writes
-- (variant_name, content); the embed endpoint
-- /api/ab-tests/active/[siteId]/route.ts:57 reads (name, variant_content).
-- Without this, variants created from the dashboard render blank on the site.
CREATE OR REPLACE FUNCTION sync_ab_test_variant_columns()
RETURNS TRIGGER AS $$
BEGIN
  NEW.name            := COALESCE(NEW.name, NEW.variant_name);
  NEW.variant_name    := COALESCE(NEW.variant_name, NEW.name);
  NEW.variant_content := COALESCE(NULLIF(NEW.variant_content, ''), NEW.content);
  NEW.content         := COALESCE(NEW.content, NULLIF(NEW.variant_content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ab_test_variants_sync_trigger ON ab_test_variants;
CREATE TRIGGER ab_test_variants_sync_trigger
  BEFORE INSERT OR UPDATE ON ab_test_variants
  FOR EACH ROW EXECUTE FUNCTION sync_ab_test_variant_columns();

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================
-- 20250817000000 enables RLS on 12 tables, none of which are the ten created
-- here — their RLS came from 20260611010000 (billing_*, team_activity,
-- collaboration_sessions), 20260731007000 (performance_metrics, ab_tests,
-- ab_test_variants) and 20260731008000 (team_invitations). All three rolled
-- back, so the complete policy set is reproduced below, verbatim and attributed.
--
-- Enabling RLS is not optional here: Supabase's default grants on the public
-- schema mean a table without RLS is readable — and generally writable — by any
-- holder of the public anon key.

-- ------------------------------------------------------------
-- billing_payment_methods   (from 20260611010000:20-56)
-- ------------------------------------------------------------
ALTER TABLE billing_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own payment methods" ON billing_payment_methods;
CREATE POLICY "Users can view their own payment methods"
  ON billing_payment_methods
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM billing_customers bc
      WHERE bc.id = billing_payment_methods.customer_id
        AND bc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage payment methods" ON billing_payment_methods;
CREATE POLICY "Service role can manage payment methods"
  ON billing_payment_methods
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update payment methods" ON billing_payment_methods;
CREATE POLICY "Service role can update payment methods"
  ON billing_payment_methods
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can delete payment methods" ON billing_payment_methods;
CREATE POLICY "Service role can delete payment methods"
  ON billing_payment_methods
  FOR DELETE
  TO service_role
  USING (true);

-- ------------------------------------------------------------
-- billing_invoices   (from 20260611010000:62-96)
-- ------------------------------------------------------------
ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own invoices" ON billing_invoices;
CREATE POLICY "Users can view their own invoices"
  ON billing_invoices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM billing_customers bc
      WHERE bc.id = billing_invoices.customer_id
        AND bc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage invoices" ON billing_invoices;
CREATE POLICY "Service role can manage invoices"
  ON billing_invoices
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update invoices" ON billing_invoices;
CREATE POLICY "Service role can update invoices"
  ON billing_invoices
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can delete invoices" ON billing_invoices;
CREATE POLICY "Service role can delete invoices"
  ON billing_invoices
  FOR DELETE
  TO service_role
  USING (true);

-- ------------------------------------------------------------
-- billing_tickets   (from 20260611010000:101-129)
-- ------------------------------------------------------------
ALTER TABLE billing_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own tickets" ON billing_tickets;
CREATE POLICY "Users can view their own tickets"
  ON billing_tickets
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage tickets" ON billing_tickets;
CREATE POLICY "Service role can manage tickets"
  ON billing_tickets
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update tickets" ON billing_tickets;
CREATE POLICY "Service role can update tickets"
  ON billing_tickets
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can delete tickets" ON billing_tickets;
CREATE POLICY "Service role can delete tickets"
  ON billing_tickets
  FOR DELETE
  TO service_role
  USING (true);

-- ------------------------------------------------------------
-- billing_ticket_usage   (from 20260611010000:134-155)
-- ------------------------------------------------------------
-- 20260611010000 gives this table no DELETE policy, unlike the other three
-- billing tables. Reproduced as written: usage is an append-only ledger, so the
-- absence is a denial by design, not an oversight to "fix" here.
ALTER TABLE billing_ticket_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own ticket usage" ON billing_ticket_usage;
CREATE POLICY "Users can view their own ticket usage"
  ON billing_ticket_usage
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage ticket usage" ON billing_ticket_usage;
CREATE POLICY "Service role can manage ticket usage"
  ON billing_ticket_usage
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update ticket usage" ON billing_ticket_usage;
CREATE POLICY "Service role can update ticket usage"
  ON billing_ticket_usage
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- team_activity   (from 20260611010000:161-180)
-- ------------------------------------------------------------
-- Reproduced verbatim, including the inline EXISTS over team_members. Be aware
-- that this predicate returns nothing today: team_members has RLS enabled with
-- no policies (20260731008000 rolled back), and RLS applies recursively inside
-- policy subqueries. It starts working the moment team_members regains a SELECT
-- policy. Nothing reads team_activity, so this is inert either way — the
-- SECURITY DEFINER helper used for team_invitations below is the pattern that
-- sidesteps it where it actually matters.
ALTER TABLE team_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can view team activity" ON team_activity;
CREATE POLICY "Team members can view team activity"
  ON team_activity
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_activity.team_id
        AND tm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can insert team activity" ON team_activity;
CREATE POLICY "Service role can insert team activity"
  ON team_activity
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ------------------------------------------------------------
-- collaboration_sessions   (from 20260611010000:185-206)
-- ------------------------------------------------------------
ALTER TABLE collaboration_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view collaboration sessions" ON collaboration_sessions;
CREATE POLICY "Site members can view collaboration sessions"
  ON collaboration_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = collaboration_sessions.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can manage their own collaboration session" ON collaboration_sessions;
CREATE POLICY "Users can manage their own collaboration session"
  ON collaboration_sessions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ------------------------------------------------------------
-- performance_metrics   (from 20260731007000:51-71)
-- ------------------------------------------------------------
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view performance metrics" ON performance_metrics;
CREATE POLICY "Site members can view performance metrics"
  ON performance_metrics
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = performance_metrics.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage performance metrics" ON performance_metrics;
CREATE POLICY "Service role can manage performance metrics"
  ON performance_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- ab_tests   (from 20260731007000:107-179)
-- ------------------------------------------------------------
-- The dashboard routes under /api/ab-tests use the anon key plus a user
-- session, so they need the authenticated-role policies; the embed endpoints
-- (/active, /bucket) use the service-role client and bypass RLS entirely.
ALTER TABLE ab_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view ab_tests" ON ab_tests;
CREATE POLICY "Site members can view ab_tests"
  ON ab_tests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ab_tests.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Site editors can create ab_tests" ON ab_tests;
CREATE POLICY "Site editors can create ab_tests"
  ON ab_tests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ab_tests.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Site editors can update ab_tests" ON ab_tests;
CREATE POLICY "Site editors can update ab_tests"
  ON ab_tests
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ab_tests.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ab_tests.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

-- Needed by the rollback path in /api/ab-tests/route.ts:196, which deletes the
-- test it just created when variant insertion fails.
DROP POLICY IF EXISTS "Site editors can delete ab_tests" ON ab_tests;
CREATE POLICY "Site editors can delete ab_tests"
  ON ab_tests
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ab_tests.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Service role can manage ab_tests" ON ab_tests;
CREATE POLICY "Service role can manage ab_tests"
  ON ab_tests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- ab_test_variants   (from 20260731007000:184-264)
-- ------------------------------------------------------------
-- Scoped through the parent test's site.
ALTER TABLE ab_test_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view ab_test_variants" ON ab_test_variants;
CREATE POLICY "Site members can view ab_test_variants"
  ON ab_test_variants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM ab_tests t
      JOIN site_permissions sp ON sp.site_id = t.site_id
      WHERE t.id = ab_test_variants.test_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Site editors can create ab_test_variants" ON ab_test_variants;
CREATE POLICY "Site editors can create ab_test_variants"
  ON ab_test_variants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ab_tests t
      JOIN site_permissions sp ON sp.site_id = t.site_id
      WHERE t.id = ab_test_variants.test_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Site editors can update ab_test_variants" ON ab_test_variants;
CREATE POLICY "Site editors can update ab_test_variants"
  ON ab_test_variants
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM ab_tests t
      JOIN site_permissions sp ON sp.site_id = t.site_id
      WHERE t.id = ab_test_variants.test_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ab_tests t
      JOIN site_permissions sp ON sp.site_id = t.site_id
      WHERE t.id = ab_test_variants.test_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Site editors can delete ab_test_variants" ON ab_test_variants;
CREATE POLICY "Site editors can delete ab_test_variants"
  ON ab_test_variants
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM ab_tests t
      JOIN site_permissions sp ON sp.site_id = t.site_id
      WHERE t.id = ab_test_variants.test_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Service role can manage ab_test_variants" ON ab_test_variants;
CREATE POLICY "Service role can manage ab_test_variants"
  ON ab_test_variants
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- team_invitations   (from 20260731008000:240-283)
-- ------------------------------------------------------------
-- 20250817000000:439 does enable RLS on team_invitations but writes no policy
-- for it, which is a total lockout; the policies below are 20260731008000's.
-- The email comparison reads the JWT rather than auth.users so the policy does
-- not depend on the auth schema being readable by `authenticated`.
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Invitees can view their invitations" ON team_invitations;
CREATE POLICY "Invitees can view their invitations"
  ON team_invitations
  FOR SELECT
  USING (
    lower(email) = lower(auth.jwt() ->> 'email')
    OR public.user_has_team_role(team_id, ARRAY['manager', 'owner'])
  );

DROP POLICY IF EXISTS "Team managers can create invitations" ON team_invitations;
CREATE POLICY "Team managers can create invitations"
  ON team_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_team_role(team_id, ARRAY['manager', 'owner']));

DROP POLICY IF EXISTS "Invitees and managers can update invitations" ON team_invitations;
CREATE POLICY "Invitees and managers can update invitations"
  ON team_invitations
  FOR UPDATE
  TO authenticated
  USING (
    lower(email) = lower(auth.jwt() ->> 'email')
    OR public.user_has_team_role(team_id, ARRAY['manager', 'owner'])
  )
  WITH CHECK (
    lower(email) = lower(auth.jwt() ->> 'email')
    OR public.user_has_team_role(team_id, ARRAY['manager', 'owner'])
  );

DROP POLICY IF EXISTS "Team managers can cancel invitations" ON team_invitations;
CREATE POLICY "Team managers can cancel invitations"
  ON team_invitations
  FOR DELETE
  TO authenticated
  USING (public.user_has_team_role(team_id, ARRAY['manager', 'owner']));

DROP POLICY IF EXISTS "Service role can manage team invitations" ON team_invitations;
CREATE POLICY "Service role can manage team invitations"
  ON team_invitations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
