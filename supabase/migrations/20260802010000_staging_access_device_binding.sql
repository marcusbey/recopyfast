-- ========================================
-- Bind a verified staging invite to the device that verified it
-- ========================================
-- What was wrong
-- --------------
-- staging_access.email_verified is a permanent boolean on a row keyed by a
-- token that travels in a URL. Once the real invitee entered their emailed code,
-- validateStagingAccess (src/lib/auth/staging-access.ts) returned full
-- permissions to ANY later bearer of that URL until expires_at — up to 30 days.
-- Forwarding the link forwarded the authorisation.
--
-- 20260801100000_editor_access_2fa.sql identified exactly this class of flaw and
-- closed it only for access_type='link' rows with no email (the self-claim
-- case). Every access_type='invite' row was left open, which is the common one:
-- it is what the dashboard's share UI actually creates.
--
-- What this adds
-- --------------
-- A fingerprint captured at the moment the code is accepted, re-checked on every
-- later use. A URL opened by a different person in a different browser no longer
-- presents the fingerprint that was recorded, so it is sent back to the
-- verification prompt — and the code needed to get past that prompt was mailed
-- to the invitee, not to them.
--
-- Only verified_user_agent_hash is enforced. origin and IP are recorded for
-- audit and deliberately NOT enforced; the reasoning for each is in the module
-- header of src/lib/auth/staging-device.ts. In short: a forwarded link is opened
-- on the same site, so origin cannot distinguish attacker from victim, and
-- roaming mobile clients would be locked out constantly by an IP binding — the
-- same conclusion editor_device_grants.ip_prefix already reached.
--
-- Existing rows
-- -------------
-- Rows verified before this migration carry no fingerprint. The application
-- treats that as a failed binding and asks for a fresh code, rather than
-- grandfathering them in — grandfathering would leave every already-forwarded
-- URL working, which is the entire vulnerability. The cost is one
-- re-verification for anyone holding a live verified token at deploy time; the
-- widget already renders a "Resend Code" affordance on that prompt.
-- ========================================

ALTER TABLE staging_access
  ADD COLUMN IF NOT EXISTS verified_user_agent_hash TEXT;

ALTER TABLE staging_access
  ADD COLUMN IF NOT EXISTS verified_origin_hash TEXT;

ALTER TABLE staging_access
  ADD COLUMN IF NOT EXISTS verified_ip_prefix TEXT;

-- When the binding was established. Drives the validity window
-- (STAGING_VERIFICATION_TTL_MS) that bounds the damage if the fingerprint is
-- ever defeated — a User-Agent is attacker-supplied and forgeable, so the time
-- bound is the control that does not depend on the client being honest.
ALTER TABLE staging_access
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN staging_access.verified_user_agent_hash IS
  'Hash of the User-Agent that passed verification. ENFORCED on every use: a forwarded URL opened in another browser fails this check and is sent back to the code prompt.';
COMMENT ON COLUMN staging_access.verified_origin_hash IS
  'Origin that passed verification. Audit only — a forwarded link is opened on the same site, so this cannot separate attacker from victim.';
COMMENT ON COLUMN staging_access.verified_ip_prefix IS
  'Truncated client IP at verification (/24 v4, /48 v6). Audit only — enforcing it would lock out roaming mobile clients.';
COMMENT ON COLUMN staging_access.verified_at IS
  'When the device binding was established. Verification expires STAGING_VERIFICATION_TTL_MS after this, independent of the token expiry.';
