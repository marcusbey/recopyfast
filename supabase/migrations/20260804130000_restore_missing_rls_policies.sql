-- Restore the RLS policies production is missing.
--
-- Sixteen tables in the live database have `relrowsecurity = true` and zero
-- policies. RLS with no policy is not "open", it is "deny everything": every
-- read under an end-user token returns the empty set and every write is
-- rejected. The service role bypasses RLS entirely, so nothing server-side ever
-- noticed, and no test noticed either because the suite mocks Supabase.
--
-- What that cost, found by paying for a Pro subscription with a test card and
-- then being refused the dashboard it bought:
--
--   * `billing_subscriptions` unreadable ⇒ `readEffectivePlanId` finds no live
--     subscription ⇒ `resolveEntitlement` returns `none` ⇒ middleware bounces
--     the customer to /dashboard/billing?checkout=required. Card charged,
--     subscription row written, access denied. Every paying customer, always.
--   * `site_permissions` unreadable ⇒ the `sites` and `content_elements`
--     policies, which are `EXISTS (SELECT 1 FROM site_permissions ...)`, match
--     nothing ⇒ every site list and every content read is empty for its owner.
--
-- The policies below are not new inventions. They are the shape already in
-- production on the tables that do work — `billing_invoices`,
-- `billing_payment_methods`, `credit_purchases`, `sites`, `content_elements`:
-- the owning user may SELECT their own rows, and the service role may write.
-- Writes stay server-side because that is where this codebase already puts
-- them; the Stripe webhook and the API routes hold the service-role client.
--
-- `rate_limits` and `security_events` deliberately get no user-facing policy.
-- They are server infrastructure and an end-user token has no business reading
-- either — a security event log readable by the subject of the log is worse
-- than one that is unreadable.
--
-- Idempotent, and it does not widen anything already correct: every statement
-- drops by name before creating, and no existing policy is touched.

-- ============================================================
-- Helper shape used throughout
-- ============================================================
-- SELECT  → TO authenticated, USING (<the user owns this row>)
-- writes  → TO service_role, USING/WITH CHECK (true)

-- ============================================================
-- Billing. The paywall reads these under the caller's token.
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own billing customer" ON billing_customers;
CREATE POLICY "Users can view their own billing customer"
  ON billing_customers FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage billing customers" ON billing_customers;
CREATE POLICY "Service role can manage billing customers"
  ON billing_customers FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their own subscriptions" ON billing_subscriptions;
CREATE POLICY "Users can view their own subscriptions"
  ON billing_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage subscriptions" ON billing_subscriptions;
CREATE POLICY "Service role can manage subscriptions"
  ON billing_subscriptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- site_permissions — the root of the authorisation graph
-- ============================================================
-- `sites` and `content_elements` both authorise through this table, so its
-- absence of policies is what made them look empty. The predicate is
-- deliberately the plain column test and never mentions `sites`: `sites`
-- already selects through here, and a mutual reference would recurse.
DROP POLICY IF EXISTS "Users can view their own site permissions" ON site_permissions;
CREATE POLICY "Users can view their own site permissions"
  ON site_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage site permissions" ON site_permissions;
CREATE POLICY "Service role can manage site permissions"
  ON site_permissions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- Per-site child tables — authorised through site_permissions
-- ============================================================
DROP POLICY IF EXISTS "Users can view content versions for their sites" ON content_versions;
CREATE POLICY "Users can view content versions for their sites"
  ON content_versions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM site_permissions sp
                 WHERE sp.site_id = content_versions.site_id
                   AND sp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role can manage content versions" ON content_versions;
CREATE POLICY "Service role can manage content versions"
  ON content_versions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view copy styles for their sites" ON copy_styles;
CREATE POLICY "Users can view copy styles for their sites"
  ON copy_styles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM site_permissions sp
                 WHERE sp.site_id = copy_styles.site_id
                   AND sp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role can manage copy styles" ON copy_styles;
CREATE POLICY "Service role can manage copy styles"
  ON copy_styles FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view domain verifications for their sites" ON domain_verifications;
CREATE POLICY "Users can view domain verifications for their sites"
  ON domain_verifications FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM site_permissions sp
                 WHERE sp.site_id = domain_verifications.site_id
                   AND sp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role can manage domain verifications" ON domain_verifications;
CREATE POLICY "Service role can manage domain verifications"
  ON domain_verifications FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view analytics for their sites" ON site_analytics;
CREATE POLICY "Users can view analytics for their sites"
  ON site_analytics FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM site_permissions sp
                 WHERE sp.site_id = site_analytics.site_id
                   AND sp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role can manage analytics" ON site_analytics;
CREATE POLICY "Service role can manage analytics"
  ON site_analytics FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view languages for their sites" ON site_languages;
CREATE POLICY "Users can view languages for their sites"
  ON site_languages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM site_permissions sp
                 WHERE sp.site_id = site_languages.site_id
                   AND sp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role can manage site languages" ON site_languages;
CREATE POLICY "Service role can manage site languages"
  ON site_languages FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view themes for their sites" ON site_themes;
CREATE POLICY "Users can view themes for their sites"
  ON site_themes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM site_permissions sp
                 WHERE sp.site_id = site_themes.site_id
                   AND sp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role can manage site themes" ON site_themes;
CREATE POLICY "Service role can manage site themes"
  ON site_themes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- content_history hangs off content_elements, which hangs off site_permissions.
DROP POLICY IF EXISTS "Users can view content history for their sites" ON content_history;
CREATE POLICY "Users can view content history for their sites"
  ON content_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1
                 FROM content_elements ce
                 JOIN site_permissions sp ON sp.site_id = ce.site_id
                 WHERE ce.id = content_history.content_element_id
                   AND sp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role can manage content history" ON content_history;
CREATE POLICY "Service role can manage content history"
  ON content_history FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- Per-user tables
-- ============================================================
-- Only the prefix and metadata are selectable in practice; `key_hash` is a hash
-- and the plaintext key is shown once at creation and never stored.
DROP POLICY IF EXISTS "Users can view their own API keys" ON api_keys;
CREATE POLICY "Users can view their own API keys"
  ON api_keys FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage API keys" ON api_keys;
CREATE POLICY "Service role can manage API keys"
  ON api_keys FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their own activity" ON user_activity_logs;
CREATE POLICY "Users can view their own activity"
  ON user_activity_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage activity logs" ON user_activity_logs;
CREATE POLICY "Service role can manage activity logs"
  ON user_activity_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- Teams
-- ============================================================
-- Neither policy references the other table. `teams` selecting through
-- `team_members` while `team_members` selects through `teams` is infinite
-- recursion at query time (42P17), which is the trap that had
-- `20260801200000` reach for a SECURITY DEFINER helper. An owner sees their
-- team by owner_id; a member sees their own membership row by user_id.
DROP POLICY IF EXISTS "Owners can view their teams" ON teams;
CREATE POLICY "Owners can view their teams"
  ON teams FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage teams" ON teams;
CREATE POLICY "Service role can manage teams"
  ON teams FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their own membership" ON team_members;
CREATE POLICY "Users can view their own membership"
  ON team_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage team members" ON team_members;
CREATE POLICY "Service role can manage team members"
  ON team_members FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- Server-only infrastructure — service role, and nothing else
-- ============================================================
-- No authenticated policy on purpose. Deny-all was the correct posture for
-- these two; they are listed here so the next audit sees the omission is a
-- decision and not another gap.
DROP POLICY IF EXISTS "Service role can manage rate limits" ON rate_limits;
CREATE POLICY "Service role can manage rate limits"
  ON rate_limits FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage security events" ON security_events;
CREATE POLICY "Service role can manage security events"
  ON security_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);
