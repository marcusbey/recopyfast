-- ========================================
-- Editor access: durable authorisation + ephemeral proof of identity
-- ========================================
-- Replaces the "URL is the credential" model in staging_access.
--
-- What was wrong
-- --------------
-- staging_access.email_verified is a permanent boolean on a row keyed by a
-- shared token. Once ANY holder of the token verified once, every subsequent
-- bearer of that token was treated as verified until expires_at
-- (src/lib/auth/staging-access.ts:188). Forwarding the URL forwarded the
-- authorisation. Worse, access_type='link' rows carry no email, so the first
-- person to open the link supplied their own address and self-authorised
-- (staging-access.ts:175). The 2FA was decorative.
--
-- The model this migration installs
-- ---------------------------------
--   DURABLE    site_editors           bob@example.com may edit example.com.
--                                     Changed only from the dashboard.
--   EPHEMERAL  editor_verification_codes -> editor_device_grants
--                                     A 6-digit emailed code proves Bob is at
--                                     the keyboard; the grant remembers that
--                                     proof for one browser, for a bounded time.
--   TRANSFER   editor_handoffs        Single-use, 60-second bearer code that
--                                     moves an authenticated hub session on
--                                     recopyfast.com into a first-party grant
--                                     on the customer's own domain.
--
-- Three properties fall out of the split:
--   1. The entry URL carries no secret, so forwarding it is harmless.
--   2. Revoking an editor (site_editors.revoked_at) kills every device grant
--      immediately, because validation joins through to the parent row rather
--      than trusting a copied boolean.
--   3. A stolen grant is useless off its origin/device: the grant is bound to
--      both, and only its hash is stored here.
--
-- Secrets are stored hashed, never raw — same discipline as api_keys.key_hash
-- (20250817000000_complete_database_setup.sql:85). A dump of these tables hands
-- an attacker nothing they can present to the API.
-- ========================================

-- ============================================================
-- site_editors — the durable allowlist
-- ============================================================
-- Keyed by email rather than auth.users.id on purpose: an editor is usually a
-- client's marketing contact who has no ReCopyFast account and never will. The
-- email IS the identity, and the emailed code is how we prove it.
CREATE TABLE IF NOT EXISTS site_editors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  -- Same vocabulary as staging_access.permissions and site_permissions so the
  -- existing normalisation in src/lib/auth/editor-access.ts keeps working.
  permissions TEXT[] NOT NULL DEFAULT ARRAY['edit']::TEXT[],
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE
);

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS; a duplicate_object trap is the
-- idempotent equivalent (same shape as 20260731010000_deferred_billing_constraints).
DO $$
BEGIN
  ALTER TABLE site_editors
    ADD CONSTRAINT site_editors_permissions_valid
      CHECK (
        permissions <@ ARRAY['view', 'edit', 'publish', 'admin']::TEXT[]
        AND array_length(permissions, 1) >= 1
      );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE site_editors
    ADD CONSTRAINT site_editors_email_lowercase
      CHECK (email = lower(email) AND position('@' IN email) > 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END
$$;

-- One row per (site, person). Re-inviting a revoked editor clears revoked_at on
-- the existing row rather than inserting a second one, so "is bob an editor of
-- this site?" is always a single unambiguous lookup. lower() in the index (not
-- just the CHECK) keeps that true even if a future writer bypasses the app.
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_editors_site_email_unique
  ON site_editors(site_id, lower(email));

-- The hub's cold-start query: "which sites may this email edit?"
CREATE INDEX IF NOT EXISTS idx_site_editors_email_active
  ON site_editors(lower(email))
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_site_editors_site_active
  ON site_editors(site_id)
  WHERE revoked_at IS NULL;

ALTER TABLE site_editors ENABLE ROW LEVEL SECURITY;

-- Only site admins manage the allowlist. Editors themselves never hold a
-- Supabase session, so they read nothing here directly — every editor-facing
-- read goes through the service-role API, which authenticates them by grant.
DROP POLICY IF EXISTS "Site admins can view site editors" ON site_editors;
CREATE POLICY "Site admins can view site editors"
  ON site_editors
  FOR SELECT
  TO authenticated
  USING (public.user_has_site_permission(site_id, ARRAY['admin']));

DROP POLICY IF EXISTS "Site admins can invite site editors" ON site_editors;
CREATE POLICY "Site admins can invite site editors"
  ON site_editors
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_site_permission(site_id, ARRAY['admin']));

DROP POLICY IF EXISTS "Site admins can update site editors" ON site_editors;
CREATE POLICY "Site admins can update site editors"
  ON site_editors
  FOR UPDATE
  TO authenticated
  USING (public.user_has_site_permission(site_id, ARRAY['admin']))
  WITH CHECK (public.user_has_site_permission(site_id, ARRAY['admin']));

DROP POLICY IF EXISTS "Service role can manage site editors" ON site_editors;
CREATE POLICY "Service role can manage site editors"
  ON site_editors
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- editor_verification_codes — the ephemeral second factor
-- ============================================================
-- Deliberately NOT a column on site_editors. A code is an event, not a property
-- of the person: several may be in flight, each is consumed exactly once, and
-- none of them may leave a lasting mark. That is precisely the mistake
-- staging_access.email_verified made.
--
-- site_id NULL  = hub-scoped code (recopyfast.com/edit — Bob has not yet chosen
--                 a site, and telling him which sites exist before he proves the
--                 address would be an enumeration oracle).
-- site_id SET   = unlock-in-place code, issued from the widget on one site.
CREATE TABLE IF NOT EXISTS editor_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  -- HMAC of the code, never the code. A 6-digit code has only 10^6 preimages,
  -- so a plain digest would be trivially reversible from a database dump; the
  -- server-side key is what makes the stored value useless on its own.
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE editor_verification_codes
    ADD CONSTRAINT editor_verification_codes_email_lowercase
      CHECK (email = lower(email));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END
$$;

-- Lookup is always "the newest live code for this email in this scope".
CREATE INDEX IF NOT EXISTS idx_editor_verification_codes_lookup
  ON editor_verification_codes(email, site_id, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_editor_verification_codes_expires
  ON editor_verification_codes(expires_at);

ALTER TABLE editor_verification_codes ENABLE ROW LEVEL SECURITY;

-- No policy for authenticated/anon at all: these rows are live secrets and
-- nothing outside the service-role API has any business reading them. RLS with
-- a service-role-only policy denies everyone else by default.
DROP POLICY IF EXISTS "Service role can manage editor verification codes" ON editor_verification_codes;
CREATE POLICY "Service role can manage editor verification codes"
  ON editor_verification_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- editor_device_grants — remembered proof, one row per browser
-- ============================================================
CREATE TABLE IF NOT EXISTS editor_device_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_editor_id UUID NOT NULL REFERENCES site_editors(id) ON DELETE CASCADE,
  -- SHA-256 of the full signed grant string. Mirrors api_keys.key_hash: the
  -- server can recognise a grant it issued but cannot reconstruct one.
  grant_hash TEXT NOT NULL UNIQUE,
  user_agent_hash TEXT,
  -- Truncated (/24 v4, /48 v6) and kept for audit only. NOT enforced: mobile
  -- clients change IP constantly and hard-binding would lock out honest editors
  -- far more often than it would stop a thief who already has the token.
  ip_prefix TEXT,
  -- The customer origin the grant was minted for. Enforced on every validate,
  -- so a grant copied out of localStorage on helloworld.com is inert anywhere
  -- else — including on recopyfast.com itself.
  origin_hash TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  -- 'rotated' | 'replay' | 'editor_revoked' | 'manual'. Distinguishing these
  -- matters: presenting a 'rotated' grant after its grace window is the signal
  -- that a token leaked, and triggers lineage-wide revocation.
  revoked_reason TEXT,
  rotated_from UUID REFERENCES editor_device_grants(id) ON DELETE SET NULL,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE editor_device_grants
    ADD CONSTRAINT editor_device_grants_revoked_reason_valid
      CHECK (
        revoked_reason IS NULL
        OR revoked_reason IN ('rotated', 'replay', 'editor_revoked', 'manual')
      );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END
$$;

-- Revocation sweeps ("kill every live grant for this editor") and the dashboard's
-- device list both filter on the parent plus liveness.
CREATE INDEX IF NOT EXISTS idx_editor_device_grants_editor_active
  ON editor_device_grants(site_editor_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_editor_device_grants_expires
  ON editor_device_grants(expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE editor_device_grants ENABLE ROW LEVEL SECURITY;

-- Admins may see and revoke the devices attached to their own site's editors.
-- grant_hash is never selected by the dashboard; it is not a secret in the
-- reversible sense but there is no reason to move it around either.
DROP POLICY IF EXISTS "Site admins can view editor device grants" ON editor_device_grants;
CREATE POLICY "Site admins can view editor device grants"
  ON editor_device_grants
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_editors se
      WHERE se.id = editor_device_grants.site_editor_id
        AND public.user_has_site_permission(se.site_id, ARRAY['admin'])
    )
  );

DROP POLICY IF EXISTS "Site admins can revoke editor device grants" ON editor_device_grants;
CREATE POLICY "Site admins can revoke editor device grants"
  ON editor_device_grants
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_editors se
      WHERE se.id = editor_device_grants.site_editor_id
        AND public.user_has_site_permission(se.site_id, ARRAY['admin'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_editors se
      WHERE se.id = editor_device_grants.site_editor_id
        AND public.user_has_site_permission(se.site_id, ARRAY['admin'])
    )
  );

DROP POLICY IF EXISTS "Service role can manage editor device grants" ON editor_device_grants;
CREATE POLICY "Service role can manage editor device grants"
  ON editor_device_grants
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- editor_handoffs — hub -> customer site, single use, 60 seconds
-- ============================================================
-- The hub authenticates Bob on recopyfast.com, but the grant has to end up in
-- localStorage on helloworld.com, and third-party cookies cannot carry it there.
-- So the hub redirects with a one-shot code in the URL which the widget
-- immediately exchanges for a real grant. The code is worthless after that
-- exchange and after 60 seconds, which is what makes it safe to put in a URL
-- that lands in browser history and Referer headers.
CREATE TABLE IF NOT EXISTS editor_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_editor_id UUID NOT NULL REFERENCES site_editors(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  remember_device BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_editor_handoffs_expires
  ON editor_handoffs(expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE editor_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage editor handoffs" ON editor_handoffs;
CREATE POLICY "Service role can manage editor handoffs"
  ON editor_handoffs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Migrate staging_access into site_editors
-- ============================================================
-- Every staging_access row that names a real person becomes a durable editor.
-- This is what makes the cutover invisible to existing invitees: the tokens they
-- were sent stop being the credential, but their authorisation survives, and the
-- next time they land on the site the widget asks them for a code instead.
--
-- Rows WITHOUT an email cannot be migrated — there is no person to authorise.
-- Those are exactly the access_type='link' self-claim rows, and they are
-- deactivated below rather than carried forward.
DO $$
DECLARE
  migrated INTEGER := 0;
  killed   INTEGER := 0;
BEGIN
  IF to_regclass('public.staging_access') IS NULL THEN
    RAISE NOTICE 'staging_access absent — nothing to migrate.';
    RETURN;
  END IF;

  INSERT INTO site_editors (site_id, email, permissions, invited_by, created_at)
  SELECT DISTINCT ON (sa.site_id, lower(sa.email))
         sa.site_id,
         lower(sa.email),
         COALESCE(sa.permissions, ARRAY['edit']::TEXT[]),
         sa.created_by,
         sa.created_at
  FROM staging_access sa
  WHERE sa.email IS NOT NULL
    AND position('@' IN sa.email) > 1
    AND sa.is_active
    AND sa.expires_at > NOW()
  ORDER BY sa.site_id, lower(sa.email), sa.created_at DESC
  ON CONFLICT (site_id, lower(email)) DO NOTHING;

  GET DIAGNOSTICS migrated = ROW_COUNT;

  -- The self-claim vector: a live token with no email attached. Anyone holding
  -- the URL could still name themselves the editor. Close it now.
  UPDATE staging_access
     SET is_active = false,
         revoked_at = COALESCE(revoked_at, NOW())
   WHERE access_type = 'link'
     AND email IS NULL
     AND is_active;

  GET DIAGNOSTICS killed = ROW_COUNT;

  RAISE NOTICE 'site_editors: % migrated from staging_access, % unclaimed link tokens deactivated.',
    migrated, killed;
END
$$;

-- ============================================================
-- Retire the access_type='link' self-claim path at the database
-- ============================================================
-- The application no longer offers it (StagingAccessManager.captureEmail now
-- refuses), but application-level retirement is one deploy away from being
-- undone. Existing 'link' rows stay readable; no new one can be created.
CREATE OR REPLACE FUNCTION public.reject_self_claim_staging_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.access_type = 'link' THEN
    RAISE EXCEPTION
      'access_type=''link'' is retired: it let the first opener of a shared URL '
      'authorise themselves. Add the person to site_editors instead.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staging_access_reject_self_claim ON staging_access;
CREATE TRIGGER staging_access_reject_self_claim
  BEFORE INSERT ON staging_access
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_self_claim_staging_access();

-- ============================================================
-- Replace the non-CSPRNG SQL code generator
-- ============================================================
-- 20251230000000_staging_workflow.sql:172 built verification codes from
-- random(), a linear congruential generator whose entire future output is
-- recoverable from a couple of observed values. Nothing calls it today (the JS
-- path in staging-access.ts uses crypto.randomInt), but it is GRANTed to
-- authenticated and one future caller would silently make codes predictable.
--
-- Rejection sampling rather than a bare modulo: 2^32 is not a multiple of 10^6,
-- so `% 1000000` alone would make the low codes marginally more likely.
CREATE OR REPLACE FUNCTION generate_verification_code()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  sample BIGINT;
BEGIN
  LOOP
    sample := ('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint;
    -- 4294000000 is the largest multiple of 10^6 that fits in 2^32 (4294967296).
    EXIT WHEN sample < 4294000000;
  END LOOP;
  RETURN lpad((sample % 1000000)::text, 6, '0');
END;
$$;

-- ============================================================
-- upsert_site_editor — invite, or restore a revoked editor
-- ============================================================
-- The uniqueness that matters is over (site_id, lower(email)), which is an
-- expression index. PostgREST's `onConflict` can only name plain columns, so the
-- conflict target is spelled out here instead of adding a second, redundant
-- unique index purely to satisfy the client library.
--
-- SECURITY INVOKER: called from the dashboard under the owner's own session, so
-- the site_editors RLS policies decide whether the caller may do this. The
-- service-role client bypasses RLS as usual.
CREATE OR REPLACE FUNCTION public.upsert_site_editor(
  p_site_id     UUID,
  p_email       TEXT,
  p_permissions TEXT[],
  p_invited_by  UUID
)
RETURNS site_editors
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  result site_editors;
BEGIN
  INSERT INTO site_editors (site_id, email, permissions, invited_by)
  VALUES (p_site_id, lower(trim(p_email)), p_permissions, p_invited_by)
  ON CONFLICT (site_id, (lower(email))) DO UPDATE
    SET permissions = EXCLUDED.permissions,
        invited_by  = EXCLUDED.invited_by,
        -- Restoring a revoked editor returns their standing permission, not
        -- their proof of identity: device grants stay revoked, so they verify
        -- again on next use.
        revoked_at  = NULL
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_site_editor(UUID, TEXT, TEXT[], UUID)
  TO authenticated, service_role;

-- ============================================================
-- Housekeeping
-- ============================================================
-- Consumed and expired ephemera have no audit value and would otherwise grow
-- without bound. Safe to call from a cron; returns rows removed.
CREATE OR REPLACE FUNCTION public.purge_expired_editor_artifacts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed INTEGER := 0;
  batch   INTEGER := 0;
BEGIN
  DELETE FROM editor_verification_codes
   WHERE expires_at < NOW() - INTERVAL '1 day';
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;

  DELETE FROM editor_handoffs
   WHERE expires_at < NOW() - INTERVAL '1 day';
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;

  -- Grants are kept 30 days past expiry: they are the audit trail for "which
  -- device edited this page", which outlives the grant's usefulness as a credential.
  DELETE FROM editor_device_grants
   WHERE expires_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;

  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_editor_artifacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_editor_artifacts() TO service_role;

-- ============================================================
-- Grants
-- ============================================================
-- Editors are not Supabase users, so `authenticated` here means the site owner
-- in the dashboard. RLS above narrows it to their own sites.
GRANT SELECT, INSERT, UPDATE ON site_editors TO authenticated;
GRANT SELECT, UPDATE ON editor_device_grants TO authenticated;

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE site_editors IS
  'Durable per-site editor allowlist keyed by email. Revoking a row here immediately invalidates every device grant beneath it.';
COMMENT ON TABLE editor_verification_codes IS
  'Single-use 6-digit second factor. Stored as an HMAC; a code is an event, never a lasting property of the editor.';
COMMENT ON TABLE editor_device_grants IS
  'Remembered proof-of-identity for one browser. Only the hash of the signed grant is stored; validation re-checks the parent site_editors row every time.';
COMMENT ON TABLE editor_handoffs IS
  'Single-use 60-second bearer code carrying an authenticated hub session onto the customer domain, where the widget exchanges it for a first-party grant.';
COMMENT ON COLUMN editor_device_grants.ip_prefix IS
  'Truncated client IP, recorded for audit. Deliberately not enforced — roaming mobile clients would be locked out constantly.';
COMMENT ON COLUMN editor_device_grants.origin_hash IS
  'SHA-256 of the customer origin the grant was minted for. Enforced on validate, so a copied grant is inert on any other origin.';
